import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncRepliesForUser } from "@/lib/gmail";
import { OAuth2Client } from "google-auth-library";
const verifier=new OAuth2Client();
export async function POST(request:NextRequest) { try { const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,""); if (!token || !process.env.PUBSUB_AUDIENCE || !process.env.PUBSUB_SERVICE_ACCOUNT) return NextResponse.json({error:"Webhook verification is not configured"},{status:401}); const ticket=await verifier.verifyIdToken({idToken:token,audience:process.env.PUBSUB_AUDIENCE}); if (ticket.getPayload()?.email !== process.env.PUBSUB_SERVICE_ACCOUNT) return NextResponse.json({error:"Unexpected push identity"},{status:401}); const message=(await request.json())?.message?.data; if (!message) return NextResponse.json({ok:true}); const data=JSON.parse(Buffer.from(message,"base64").toString("utf8")); const user=await db.user.findUnique({where:{email:data.emailAddress}}); if (user) await syncRepliesForUser(user.id); return NextResponse.json({ok:true}); } catch { return NextResponse.json({error:"Invalid Gmail notification"},{status:401}); } }
