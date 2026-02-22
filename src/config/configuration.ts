export default () => ({
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 3000,

  // MongoDB
  mongodb: {
    uri: process.env.MONGODB_URI,
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiration: process.env.JWT_EXPIRATION || "7d",
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || "30d",
  },

  // AWS S3
  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.AWS_S3_BUCKET,
  },

  // SendGrid
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY,
    fromEmail: process.env.SENDGRID_FROM_EMAIL,
    fromName: process.env.SENDGRID_FROM_NAME,
  },

  // Twilio (SMS)
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },

  // Frontend
  frontendUrl: process.env.FRONTEND_URL,
});
