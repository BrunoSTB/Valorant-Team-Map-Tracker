const fs = require('fs');

const val = (key) => (process.env[key] || '').trim();

const content = `export const environment = {
  firebase: {
    apiKey: '${val('FIREBASE_API_KEY')}',
    authDomain: '${val('FIREBASE_AUTH_DOMAIN')}',
    projectId: '${val('FIREBASE_PROJECT_ID')}',
    storageBucket: '${val('FIREBASE_STORAGE_BUCKET')}',
    messagingSenderId: '${val('FIREBASE_MESSAGING_SENDER_ID')}',
    appId: '${val('FIREBASE_APP_ID')}',
  },
};`;

fs.writeFileSync('src/environments/environment.ts', content);
