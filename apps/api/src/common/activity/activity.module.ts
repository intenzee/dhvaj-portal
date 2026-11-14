import { Global, Module } from '@nestjs/common';
import { ActivityMiddleware } from './activity.middleware';
import { ActivityService } from './activity.service';

@Global()
@Module({
  providers: [ActivityService, ActivityMiddleware],
  exports: [ActivityService, ActivityMiddleware],
})
export class ActivityModule {}
