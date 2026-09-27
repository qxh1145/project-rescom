import { Module } from '@nestjs/common';
import { AiPromptService } from './application/ai-prompt.service';
import { AiFormsController } from './presentation/ai-forms.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AiFormsController],
  providers: [AiPromptService],
  exports: [AiPromptService],
})
export class AiModule {}
