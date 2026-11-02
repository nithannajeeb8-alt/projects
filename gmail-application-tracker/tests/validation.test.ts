import { describe, expect, it } from "vitest";
import { campaignInput, recipientInput, render } from "../lib/validation";

describe("application input safeguards", () => {
  it("rejects invalid recipient addresses", () => expect(recipientInput.safeParse({email:"not-an-email",company:"A",role:"Intern"}).success).toBe(false));
  it("renders only supplied factual template fields", () => expect(render("{{name}} applying for {{role}} at {{company}}",{company:"Example",role:"Intern"},{name:"Ada",email:"ada@example.com",experience:"Project"})).toBe("Ada applying for Intern at Example"));
  it("requires an applicant profile and a review template", () => expect(campaignInput.safeParse({name:"Test",profile:{name:"Ada",email:"ada@example.com",experience:"Project"},subjectTemplate:"Hi",bodyTemplate:"Body",aiOptIn:false}).success).toBe(true));
});
