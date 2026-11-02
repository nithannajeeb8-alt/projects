import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { z } from "zod";
import { suggestApplication } from "@/lib/assistant";
const input=z.object({company:z.string().min(1),role:z.string().min(1),opportunity:z.string().max(12000)});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) { const userId=await requireUser(); if (!userId) return unauthorized(); const campaign=await db.campaign.findFirst({where:{id:(await params).id,userId}}); if (!campaign) return NextResponse.json({error:"Not found"},{status:404}); if (!campaign.aiOptIn) return NextResponse.json({error:"Enable AI assistance when creating this campaign before using it"},{status:403}); const parsed=input.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({error:"Company and role are required"},{status:400}); try { return NextResponse.json({suggestion:await suggestApplication({profile:JSON.stringify(campaign.profileJson),...parsed.data})}); } catch (e) { return NextResponse.json({error:e instanceof Error ? e.message : "Suggestion unavailable"},{status:503}); } }
