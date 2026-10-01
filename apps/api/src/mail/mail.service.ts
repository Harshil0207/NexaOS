import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { AppConfig, CONFIG } from '../config/config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailResult =
  { status: 'sent'; messageId: string } | { status: 'unavailable'; reason: string };

/** SMTP adapter. When SMTP_URL is absent it reports `unavailable`; it never pretends to send. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  async send(msg: MailMessage): Promise<MailResult> {
    if (!this.transport) return { status: 'unavailable', reason: 'SMTP_URL is not configured' };
    const info = await this.transport.sendMail({ from: this.config.MAIL_FROM, ...msg });
    this.logger.log({ messageId: info.messageId }, 'Email sent');
    return { status: 'sent', messageId: String(info.messageId) };
  }
}
