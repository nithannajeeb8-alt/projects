import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
const cookieName = "application-session";
function secret() { const v = process.env.APP_SESSION_SECRET; if (!v || v.length < 32) throw new Error("APP_SESSION_SECRET must be at least 32 characters"); return new TextEncoder().encode(v); }
export async function setSession(userId: string) { const token = await new EncryptJWT({ sub: userId }).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuedAt().setExpirationTime("7d").encrypt(secret()); (await cookies()).set(cookieName, token, { httpOnly:true, secure:process.env.NODE_ENV === "production", sameSite:"lax", path:"/" }); }
export async function currentUserId() { const token = (await cookies()).get(cookieName)?.value; if (!token) return null; try { return (await jwtDecrypt(token, secret())).payload.sub ?? null; } catch { return null; } }
export async function clearSession() { (await cookies()).delete(cookieName); }
