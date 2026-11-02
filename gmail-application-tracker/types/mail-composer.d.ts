declare module "nodemailer/lib/mail-composer" {
  export default class MailComposer {
    constructor(options: Record<string, unknown>);
    compile(): { build(): Promise<Buffer> };
  }
}
