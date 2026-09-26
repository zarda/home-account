import { createTransport } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

/**
 * The transport seam: the only file that imports nodemailer. Everything the
 * mail says was already composed by the time it reaches here.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /**
   * Bounds each connection phase (DNS, connect, greeting, idle socket).
   * nodemailer's timeouts are per phase, not a total, so this is not a
   * deadline on the send: a caller that must answer in time owns its own and
   * abandons the send, and this is what eventually releases the abandoned
   * socket. Left unset, nodemailer's defaults apply.
   */
  timeoutMs?: number;
}

export interface OutgoingMail {
  to: string;
  from: string;
  subject: string;
  text: string;
}

export function transportOptions(smtp: SmtpConfig): SMTPTransport.Options {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    ...(smtp.timeoutMs === undefined
      ? {}
      : {
          connectionTimeout: smtp.timeoutMs,
          greetingTimeout: smtp.timeoutMs,
          socketTimeout: smtp.timeoutMs,
          dnsTimeout: smtp.timeoutMs,
        }),
  };
}

export async function sendMail(smtp: SmtpConfig, mail: OutgoingMail): Promise<void> {
  const transport = createTransport(transportOptions(smtp));
  await transport.sendMail(mail);
}
