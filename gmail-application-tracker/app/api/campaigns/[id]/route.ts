import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized } from "@/lib/auth";
import { deleteResume } from "@/lib/blob-store";
async function owned(userId:string,id:string) { return db.campaign.findFirst({where:{id,userId}}); }
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}) { const userId=await requireUser(); if (!userId) return unauthorized(); const campaign=await owned(userId,(await params).id); if (!campaign) return NextResponse.json({error:"Not found"},{status:404}); if (campaign.resumeKey) await deleteResume(campaign.resumeKey); await db.campaign.delete({where:{id:campaign.id}}); return NextResponse.json({ok:true}); }
