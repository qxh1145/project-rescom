import { createExternalSurveySchema } from "./external-form.schema";
import { createFormDraftSchema, updateFormDraftSchema } from "./form-draft.schema";
import { publishFormSchema } from "./form-publish.schema";
import {
  EXTERNAL_SURVEY_URL_NOT_ALLOWED_MESSAGE,
  externalSurveyUrlSchema,
  isGoogleFormsUrl,
  isHttpsUrl,
} from "./external-url.schema";

const accepted = [
  "https://docs.google.com/forms/d/e/abc/viewform",
  "HTTPS://forms.gle/abc",
  "  https://forms.gle/padded  ",
  "https://forms.google.com/some-form",
  "https://DOCS.GOOGLE.COM/forms/d/abc/edit",
];
const rejected = [
  "http://docs.google.com/forms/d/e/abc/viewform",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "ftp://example.com/survey",
  "not-a-url",
  `https://example.com/${"a".repeat(2000)}`,
];
/** Valid HTTPS links that are not Google Forms (decision E4-DN3). */
const notGoogleForms = [
  "https://www.surveymonkey.com/r/abc",
  "https://example.com/survey",
  "https://docs.google.com/document/d/abc/edit",
  "https://docs.google.com/spreadsheets/d/abc",
  "https://docs.google.com/formsfake/abc",
  "https://docs.google.com/forms",
  "https://docs.google.com/forms/",
  "https://forms.gle/",
  "https://forms.google.com/",
  "https://docs.google.com.evil.example/forms/d/abc",
  "https://evil.example/forms.gle/abc",
  "https://user:pass@forms.gle/abc",
  "https://forms.gle:8443/abc",
];

describe("externalSurveyUrlSchema (Epic 4 review P6)", () => {
  it.each(accepted)("accepts %s", (url) => {
    expect(externalSurveyUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each(rejected)("rejects %s", (url) => {
    expect(externalSurveyUrlSchema.safeParse(url).success).toBe(false);
  });

  it("trims the value", () => {
    expect(externalSurveyUrlSchema.parse("  https://forms.gle/padded  ")).toBe(
      "https://forms.gle/padded",
    );
  });

  it("isHttpsUrl only accepts the https: scheme", () => {
    expect(isHttpsUrl("https://forms.gle/x")).toBe(true);
    expect(isHttpsUrl("http://forms.gle/x")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
  });

  describe("Google Forms allowlist (decision E4-DN3)", () => {
    it.each(notGoogleForms)("rejects the non-Google-Forms link %s", (url) => {
      const result = externalSurveyUrlSchema.safeParse(url);
      expect(result.success).toBe(false);
      if (!result.success && isHttpsUrl(url)) {
        expect(result.error.errors.map((e) => e.message)).toContain(
          EXTERNAL_SURVEY_URL_NOT_ALLOWED_MESSAGE,
        );
      }
    });

    it("isGoogleFormsUrl requires a /forms/<id> path on docs.google.com and a path on the short hosts", () => {
      expect(isGoogleFormsUrl("https://docs.google.com/forms/d/e/x/viewform")).toBe(true);
      expect(isGoogleFormsUrl("https://forms.gle/x")).toBe(true);
      expect(isGoogleFormsUrl("https://forms.google.com/x")).toBe(true);
      for (const url of notGoogleForms) {
        expect(isGoogleFormsUrl(url)).toBe(false);
      }
      expect(isGoogleFormsUrl("not-a-url")).toBe(false);
      expect(isGoogleFormsUrl("")).toBe(false);
      // Safe on its own too: only the https: scheme counts.
      expect(isGoogleFormsUrl("javascript://docs.google.com/forms/x")).toBe(false);
      expect(isGoogleFormsUrl("http://forms.gle/x")).toBe(false);
    });
  });

  describe("every External-URL entry point uses the HTTPS rule", () => {
    const entryPoints: Array<[string, (url: string) => boolean]> = [
      [
        "createExternalSurveySchema",
        (externalUrl) =>
          createExternalSurveySchema.safeParse({ title: "T", externalUrl }).success,
      ],
      [
        "createFormDraftSchema",
        (externalUrl) =>
          createFormDraftSchema.safeParse({ type: "EXTERNAL", externalUrl }).success,
      ],
      [
        "updateFormDraftSchema",
        (externalUrl) =>
          updateFormDraftSchema.safeParse({
            clientUpdatedAt: "2026-09-26T00:00:00.000Z",
            externalUrl,
          }).success,
      ],
      [
        "publishFormSchema",
        (externalUrl) => publishFormSchema.safeParse({ externalUrl }).success,
      ],
    ];

    it.each(entryPoints)("%s rejects http:, javascript:, data:, over-long and non-Google-Forms URLs", (_name, parses) => {
      for (const url of [...rejected, ...notGoogleForms]) {
        expect(parses(url)).toBe(false);
      }
      expect(parses("https://forms.gle/ok")).toBe(true);
      expect(parses("https://docs.google.com/forms/d/e/ok/viewform")).toBe(true);
    });

    it("optional entry points still accept null", () => {
      expect(createFormDraftSchema.safeParse({ externalUrl: null }).success).toBe(true);
      expect(publishFormSchema.safeParse({ externalUrl: null }).success).toBe(true);
    });
  });
});
