import type { FlexiEvidencePermissions } from "../types.js";

export const defaultEvidencePermissions: FlexiEvidencePermissions = {
  read: [
    "adresar",
    "adresar-bankovni-ucet",
    "dodavatel",
    "cenik",
    "faktura-vydana",
    "faktura-vydana-polozka",
    "faktura-prijata",
    "faktura-prijata-polozka",
    "pohledavka",
    "pohledavka-polozka",
    "zavazek",
    "zavazek-polozka",
    "banka",
    "banka-polozka",
    "pokladni-pohyb",
    "pokladni-pohyb-polozka",
    "interni-doklad",
    "interni-doklad-polozka",
    "saldo",
    "saldo-k-datu",
    "neuhrazene-po-splatnosti",
    "neuhrazene-po-splatnosti-2",
    "forma-uhrady",
    "pokladna",
    "bankovni-ucet-pokladna",
    "stat",
    "stredisko",
    "zakazka",
    "cinnost",
    "typ-interniho-dokladu",
    "typ-dokladu",
    "predpis-zauctovani"
  ],
  dryRun: [
    "adresar",
    "faktura-vydana",
    "faktura-prijata",
    "pohledavka",
    "zavazek",
    "banka",
    "pokladni-pohyb",
    "interni-doklad"
  ],
  write: [
    "adresar",
    "faktura-vydana",
    "faktura-prijata",
    "pohledavka",
    "zavazek",
    "banka",
    "pokladni-pohyb",
    "interni-doklad"
  ]
};
