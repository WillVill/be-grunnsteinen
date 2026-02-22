import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;
  const nodeEnv = configService.get<string>('nodeEnv');

  // Security: Helmet for HTTP headers
  app.use(helmet());

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global validation pipe with security enhancements
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Throw error if non-whitelisted properties are present
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true,
      },
      // Don't expose sensitive error details
      disableErrorMessages: nodeEnv === 'production',
      // Validate nested objects
      validateCustomDecorators: true,
      // Stop at first error for better performance
      stopAtFirstError: false,
    }),
  );

  // Swagger configuration (non-production only)
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Heime API')
      .setDescription('Neighborhood community platform API')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });

    logger.log(`Swagger documentation available at /api/docs`);
  }

  // CORS - Properly configured with security in mind
  const frontendUrl = configService.get<string>('frontendUrl');
  const allowedOrigins = frontendUrl
    ? frontendUrl.split(',').map((url) => url.trim())
    : nodeEnv === 'production'
      ? []
      : true; // Allow all origins in development

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}
bootstrap();
