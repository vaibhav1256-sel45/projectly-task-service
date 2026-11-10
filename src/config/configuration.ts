export default () => ({
  port: parseInt(process.env.PORT ?? '3004', 10),

  grpc: {
    authUrl: process.env.AUTH_GRPC_URL ?? 'localhost:50051',
    userUrl: process.env.USER_GRPC_URL ?? 'localhost:50056',
    projectUrl: process.env.PROJECT_GRPC_URL ?? 'localhost:50054',
    // address this service listens on for other services
    url: process.env.GRPC_URL ?? '0.0.0.0:50058',
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://localhost:5672',
  },

  // used for the links in the emails
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  // LLM for the AI task suggestions; without a key that endpoint answers 503
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
  },

  mongo: {
    uri: process.env.MONGO_URI,
  },
});
