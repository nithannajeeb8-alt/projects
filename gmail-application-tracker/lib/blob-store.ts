import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { encrypt, decrypt } from "./crypto";

const bucket = process.env.S3_BUCKET;
const s3 = bucket ? new S3Client({ region:process.env.S3_REGION, endpoint:process.env.S3_ENDPOINT, credentials:process.env.S3_ACCESS_KEY_ID ? {accessKeyId:process.env.S3_ACCESS_KEY_ID!, secretAccessKey:process.env.S3_SECRET_ACCESS_KEY!} : undefined }) : null;
const localDir = path.join(process.cwd(), ".private-uploads");
export async function putResume(userId:string, file:File) {
  if (file.type !== "application/pdf" || file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error("Resume must be a PDF under 10 MB");
  const key = `resumes/${userId}/${crypto.randomUUID()}.enc`; const encrypted = encrypt(Buffer.from(await file.arrayBuffer()));
  if (s3 && bucket) await s3.send(new PutObjectCommand({Bucket:bucket, Key:key, Body:encrypted, ContentType:"application/octet-stream", ServerSideEncryption:"aws:kms"}));
  else { await fs.mkdir(localDir, {recursive:true}); await fs.writeFile(path.join(localDir, key.replaceAll("/", "_")), encrypted); }
  return key;
}
export async function getResume(key:string) {
  let encrypted:Buffer;
  if (s3 && bucket) { const result = await s3.send(new GetObjectCommand({Bucket:bucket,Key:key})); encrypted = Buffer.from(await result.Body!.transformToByteArray()); }
  else encrypted = await fs.readFile(path.join(localDir, key.replaceAll("/", "_")));
  return decrypt(encrypted.toString());
}
export async function deleteResume(key:string) {
  if (s3 && bucket) await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
  else await fs.rm(path.join(localDir, key.replaceAll("/", "_")), {force:true});
}
