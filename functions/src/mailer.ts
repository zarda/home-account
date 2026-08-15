import { createTransport } from 'nodemailer';

/**
 * The transport seam: the only file that imports nodemailer. Everything the
 * mail says was already composed by the time it reaches here.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface OutgoingMail {
  to: string;
  from: string;
  subject: string;
  text: string;
}

export async function sendMail(smtp: SmtpConfig, mail: OutgoingMail): Promise<void> {
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  await transport.sendMail(mail);
}
