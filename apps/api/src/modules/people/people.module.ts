import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { StorageModule } from '../documents/storage/storage.module';
import { ArticleshipController } from './articleship.controller';
import { ArticleshipService } from './articleship.service';
import { HrDocumentsController } from './hr-documents.controller';
import { HrDocumentsService } from './hr-documents.service';
import { PeopleController } from './people.controller';
import { PeopleExitsScheduler } from './people-exits.scheduler';
import { PeopleService } from './people.service';

/**
 * The HR People desk (spec docs/accountant-hr-roles-spec.md §4): attendance,
 * workload as counts, the desk's queues, exits, the articleship register and
 * the HR documents vault. Never client work.
 */
@Module({
  imports: [AuditModule, IdentityModule, NotificationsModule, OrganisationModule, StorageModule],
  controllers: [PeopleController, ArticleshipController, HrDocumentsController],
  providers: [PeopleService, ArticleshipService, HrDocumentsService, PeopleExitsScheduler],
  exports: [PeopleService, HrDocumentsService, PeopleExitsScheduler],
})
export class PeopleModule {}
