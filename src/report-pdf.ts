interface AssetsLiabilitiesPdfRow {
  account_code: string;
  account_name: string;
  debit_balance?: string;
  credit_balance?: string;
}

function stripDiacritics(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizePdfText(value: string): string {
  return stripDiacritics(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, " ");
}

function truncate(value: string, length: number): string {
  const normalized = stripDiacritics(value);
  if (normalized.length <= length) {
    return normalized.padEnd(length, " ");
  }
  return `${normalized.slice(0, Math.max(0, length - 1))}~`;
}

function formatAmount(value: string | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "";
  }
  return amount.toFixed(2);
}

function buildContentStream(lines: string[]): string {
  const rendered: string[] = [
    "BT",
    "/F1 10 Tf",
    "40 800 Td"
  ];

  lines.forEach((line, index) => {
    if (index > 0) {
      rendered.push("0 -14 Td");
    }
    rendered.push(`(${normalizePdfText(line)}) Tj`);
  });

  rendered.push("ET");
  return rendered.join("\n");
}

function buildPdfDocument(pageLines: string[][]): Buffer {
  const objects: string[] = [];
  const fontId = 3;
  const pageIds: number[] = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "";
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";

  let nextId = 4;
  for (const lines of pageLines) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageIds.push(pageId);
    const stream = buildContentStream(lines);
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  }

  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 1; index < objects.length; index += 1) {
    const body = objects[index];
    if (!body) {
      continue;
    }
    offsets[index] = Buffer.byteLength(pdf, "utf8");
    pdf += `${index} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index += 1) {
    const offset = offsets[index] ?? 0;
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

export function buildAssetsLiabilitiesPdfFromRecords(input: {
  company_name: string;
  company_slug: string;
  accounting_period?: string;
  exported_at: string;
  rows: AssetsLiabilitiesPdfRow[];
}): Buffer {
  const period = input.accounting_period?.trim() || "aktualni-obdobi";
  const exportedAt = stripDiacritics(input.exported_at.replace("T", " ").replace("Z", " UTC"));
  const lines: string[] = [
    "Soupis aktiv a pasiv",
    `Firma: ${stripDiacritics(input.company_name)} (${input.company_slug})`,
    `Obdobi: ${stripDiacritics(period)}`,
    `Export: ${exportedAt}`,
    "",
    "Tento PDF soupis byl vygenerovan z reportovych dat ABRA Flexi.",
    "",
    `${"Ucet".padEnd(14, " ")} ${"Nazev uctu".padEnd(48, " ")} ${"MD".padStart(14, " ")} ${"DAL".padStart(14, " ")}`,
    `${"-".repeat(14)} ${"-".repeat(48)} ${"-".repeat(14)} ${"-".repeat(14)}`
  ];

  let debitTotal = 0;
  let creditTotal = 0;

  for (const row of input.rows) {
    const debit = Number(row.debit_balance ?? 0);
    const credit = Number(row.credit_balance ?? 0);
    if (Number.isFinite(debit)) {
      debitTotal += debit;
    }
    if (Number.isFinite(credit)) {
      creditTotal += credit;
    }
    lines.push(
      `${truncate(row.account_code, 14)} ${truncate(row.account_name, 48)} ${formatAmount(row.debit_balance).padStart(14, " ")} ${formatAmount(row.credit_balance).padStart(14, " ")}`
    );
  }

  lines.push("");
  lines.push(
    `${"CELKEM".padEnd(14, " ")} ${"".padEnd(48, " ")} ${debitTotal.toFixed(2).padStart(14, " ")} ${creditTotal.toFixed(2).padStart(14, " ")}`
  );

  const pageSize = 50;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageSize) {
    pages.push(lines.slice(index, index + pageSize));
  }

  return buildPdfDocument(pages);
}
