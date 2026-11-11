import { IsString, Matches, MaxLength } from "class-validator";

const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;
const EXPO_PUSH_TOKEN_MESSAGE = "token must be an Expo push token";

export class PushTokenDto {
  @IsString()
  @MaxLength(200)
  @Matches(EXPO_PUSH_TOKEN, { message: EXPO_PUSH_TOKEN_MESSAGE })
  token: string;
}

/** Path-parameter variant, for DELETE (the app's apiClient.delete sends no body). */
export class PushTokenParamDto {
  @IsString()
  @MaxLength(200)
  @Matches(EXPO_PUSH_TOKEN, { message: EXPO_PUSH_TOKEN_MESSAGE })
  token: string;
}
