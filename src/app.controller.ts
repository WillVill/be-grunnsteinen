import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { AppService } from "./app.service";
import { Public } from "./common/decorators/public.decorator";

@ApiTags("Health")
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: "Health check",
    description: "Returns a hello message to verify the API is running",
  })
  @ApiResponse({ status: 200, description: "API is healthy", type: String })
  getHello(): string {
    return this.appService.getHello();
  }
}
