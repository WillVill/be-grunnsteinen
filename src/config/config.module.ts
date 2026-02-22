import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
  ],
})
export class AppConfigModule {}

