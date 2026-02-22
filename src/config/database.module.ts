import { Module, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: async (configService: ConfigService) => {
        const logger = new Logger('DatabaseModule');
        const uri = configService.get<string>('mongodb.uri');

        return {
          uri,
          connectionFactory: (connection) => {
            connection.on('connected', () => {
              logger.log('MongoDB connected successfully');
            });
            connection.on('error', (error) => {
              logger.error('MongoDB connection error:', error.message);
            });
            connection.on('disconnected', () => {
              logger.warn('MongoDB disconnected');
            });
            return connection;
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}

