import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ActivityService, countsAsActivity, isWriteMethod } from './activity.service';

/** Notes every request (health probes aside) as the portal being used. */
@Injectable()
export class ActivityMiddleware implements NestMiddleware {
  constructor(private readonly activity: ActivityService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (countsAsActivity(req.originalUrl ?? req.url)) {
      this.activity.touch(isWriteMethod(req.method));
    }
    next();
  }
}
