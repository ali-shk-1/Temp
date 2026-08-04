const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  SMTP_SECURE,
  NODE_ENV,
} = process.env;

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_HOST || !SMTP_PORT) {
    console.warn('Mailer is not configured: SMTP_HOST and SMTP_PORT are required. Emails will be skipped.');
    return null;
  }

  const port = parseInt(SMTP_PORT, 10);
  const secure = SMTP_SECURE === 'true' || SMTP_SECURE === '1' || port === 465;
  const transportOptions = {
    host: SMTP_HOST,
    port,
    secure,
  };

  if (SMTP_USER && SMTP_PASS) {
    transportOptions.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS,
    };
  }

  transporter = nodemailer.createTransport(transportOptions);
  return transporter;
}

async function sendMail({ to, subject, text, html, from }) {
  if (NODE_ENV === 'test') {
    return Promise.resolve();
  }

  const transport = getTransporter();
  if (!transport) {
    return Promise.resolve();
  }

  const message = {
    from: from || SMTP_FROM || 'School Administration <no-reply@school.local>',
    to,
    subject,
    text,
    html,
  };

  return transport.sendMail(message);
}

module.exports = { sendMail };
