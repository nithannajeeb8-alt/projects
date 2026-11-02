import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthorizationUrl } from "@/lib/gmail";
export async function GET() { const state=crypto.randomBytes(24).toString("base64url"); const response=NextResponse.redirect(googleAuthorizationUrl(state)); response.cookies.set("google-oauth-state",state,{httpOnly:true,secure:process.env.NODE_ENV === "production",sameSite:"lax",maxAge:600,path:"/"}); return response; }
