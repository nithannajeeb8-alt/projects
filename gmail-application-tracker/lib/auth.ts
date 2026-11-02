import { NextResponse } from "next/server";
import { currentUserId } from "./session";
export async function requireUser() { const id=await currentUserId(); if (!id) return null; return id; }
export function unauthorized() { return NextResponse.json({error:"Sign in with Gmail first"},{status:401}); }
