import { describe, expect, it } from "vitest";
import { extractCompanies, normalizeFlexiResponse } from "./flexi-response.js";

describe("normalizeFlexiResponse", () => {
  it("parses json success payloads", () => {
    const response = normalizeFlexiResponse(
      "json",
      200,
      JSON.stringify({
        winstrom: {
          success: "true",
          message: "OK"
        }
      }),
      {}
    );

    expect(response.ok).toBe(true);
    expect(response.messages).toContain("OK");
    expect(response.errors).toEqual([]);
  });

  it("parses xml error payloads", () => {
    const response = normalizeFlexiResponse(
      "xml",
      400,
      "<winstrom version=\"1.0\"><success>false</success><errors><error>Neplatny kod</error></errors></winstrom>",
      {}
    );

    expect(response.ok).toBe(false);
    expect(response.flexi_success).toBe(false);
    expect(response.errors).toContain("Neplatny kod");
  });

  it("uses failure messages as errors when Flexi only returns authRequired", () => {
    const response = normalizeFlexiResponse(
      "json",
      401,
      JSON.stringify({
        winstrom: {
          success: "false",
          message: "Je potřebná autorizace.",
          "message@messageCode": "authRequired"
        }
      }),
      { "content-type": "application/json" }
    );

    expect(response.ok).toBe(false);
    expect(response.errors).toContain("Je potřebná autorizace.");
  });

  it("returns a structured parse error for unexpected html", () => {
    const response = normalizeFlexiResponse(
      "json",
      500,
      "<!DOCTYPE html><html><body>Login</body></html>",
      { "content-type": "text/html" }
    );

    expect(response.ok).toBe(false);
    expect(response.parse_error).toContain("Flexi returned HTML");
    expect(response.errors[0]).toContain("Flexi returned HTML");
  });

  it("extracts companies from json payloads", () => {
    const companies = extractCompanies({
      companies: {
        company: [
          {
            id: -2,
            dbNazev: "example_company_s_r_o_",
            nazev: "Example Company s.r.o.",
            show: true,
            stavEnum: "ESTABLISHED",
            watchingChanges: true,
            createDt: "2020-03-05T12:51:18.757+01:00"
          }
        ]
      }
    });

    expect(companies).toHaveLength(1);
    expect(companies[0]?.dbNazev).toBe("example_company_s_r_o_");
    expect(companies[0]?.show).toBe(true);
  });

  it("extracts companies from xml payloads", () => {
    const response = normalizeFlexiResponse(
      "xml",
      200,
      "<companies><company><id>-2</id><dbNazev>example_company_s_r_o_</dbNazev><nazev>Example Company</nazev><show>true</show><stavEnum>ESTABLISHED</stavEnum><watchingChanges>true</watchingChanges><createDt>2020-03-05T12:51:18.757+01:00</createDt></company></companies>",
      {}
    );

    const companies = extractCompanies(response.data);
    expect(companies).toHaveLength(1);
    expect(companies[0]?.nazev).toBe("Example Company");
  });
});
