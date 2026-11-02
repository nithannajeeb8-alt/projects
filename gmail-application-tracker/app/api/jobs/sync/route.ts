import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncRepliesForUser, startMailboxWatch } from "@/lib/gmail";
export async function POST(request:NextRequest) { if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({error:"Unauthorized"},{status:401}); const users=await db.user.findMany({select:{id:true,watchExpiry:true}}); for (const user of users) { await syncRepliesForUser(user.id); if (!user.watchExpiry || user.watchExpiry.getTime() < Date.now()+24*60*60*1000) await startMailboxWatch(user.id); } return NextResponse.json({ok:true,count:users.length}); }
