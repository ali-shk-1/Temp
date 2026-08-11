import nodemailer, { Transporter } from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  SMTP_SECURE,
  NODE_ENV,
} = process.env;

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!SMTP_HOST || !SMTP_PORT) {
    console.warn('Mailer is not configured: SMTP_HOST and SMTP_PORT are required. Emails will be skipped.');
    transporter = null;
    return null;
  }

  const port = parseInt(SMTP_PORT, 10);
  const secure = SMTP_SECURE === 'true' || SMTP_SECURE === '1' || port === 465;
  const transportOptions: any = { host: SMTP_HOST, port, secure };

  if (SMTP_USER && SMTP_PASS) {
    transportOptions.auth = { user: SMTP_USER, pass: SMTP_PASS };
  }

  transporter = nodemailer.createTransport(transportOptions);
  transporter
    .verify()
    .then(() => console.log('SMTP transporter verified and ready.'))
    .catch((err: Error) => console.error('SMTP transporter verification failed:', err.message));
  return transporter;
}

export interface SendMailArgs {
  to: string;
  subject: string;
  text: string;
  html: string;
  from?: string;
}

export async function sendMail({ to, subject, text, html, from }: SendMailArgs): Promise<any> {
  if (NODE_ENV === 'test') {
    return Promise.resolve();
  }

  const transport = getTransporter();
  if (!transport) {
    console.warn('Mailer not configured: email skipped for', to);
    return Promise.resolve();
  }

  const message = {
    from: from || SMTP_FROM || 'School Administration <no-reply@school.local>',
    to,
    subject,
    text,
    html,
  };

  console.log('Sending email to', to, 'subject:', subject);
  try {
    const info = await transport.sendMail(message);
    console.log('Email sent:', info.messageId);
    return info;
  } catch (err: any) {
    console.error('Email send failed:', err.message, err.response || '');
    throw err;
  }
}