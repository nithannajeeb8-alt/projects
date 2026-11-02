import "server-only";
import OpenAI from "openai";
export async function suggestApplication(input:{profile:string; company:string; role:string; opportunity:string}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("AI assistance is not configured");
  const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
  const response=await client.responses.create({model:process.env.OPENAI_MODEL || "gpt-5.5",store:false,instructions:"Draft a concise job-application email using only the facts supplied. Never invent experience, education, or achievements. Return plain text with a subject line and body. This is a suggestion for human review, not an application to send.",input:`PROFILE:\n${input.profile}\n\nCOMPANY: ${input.company}\nROLE: ${input.role}\nOPPORTUNITY:\n${input.opportunity}`});
  return response.output_text;
}
