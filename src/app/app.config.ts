import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { environment } from '../environments/environment';

initializeApp(environment.firebase);

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners()],
};
