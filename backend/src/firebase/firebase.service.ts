import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { initializeApp, getApps, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private db: Firestore;

  onModuleInit(): void {
    let app: App;
    if (getApps().length === 0) {
      app = initializeApp({ credential: applicationDefault() });
    } else {
      app = getApps()[0];
    }
    this.db = getFirestore(app);
    this.logger.log('Firebase Admin SDK initialized');
  }

  /**
   * Ensures the session document exists, then appends a message to the
   * messages subcollection.
   *
   * Schema:
   *   conversations/{sessionId}
   *     business, startedAt
   *     └── messages/{auto-id}
   *           role: 'user' | 'assistant'
   *           text: string
   *           timestamp: Timestamp
   */
  async saveMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    text: string,
    business: string,
  ): Promise<void> {
    if (!text?.trim()) return;

    try {
      const sessionRef = this.db.collection('conversations').doc(sessionId);

      await sessionRef.set(
        { business, startedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );

      await sessionRef.collection('messages').add({
        role,
        text: text.trim(),
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (err: any) {
      // this.logger.error(`Failed to save message [${role}]: ${err.message}`);
    }
  }
}
