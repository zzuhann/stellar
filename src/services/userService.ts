import { db, hasFirebaseConfig, withTimeoutAndRetry } from '../config/firebase';
import { User, UpdateUserData } from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';

export class UserService {
  private collection = hasFirebaseConfig && db ? db.collection('users') : null;

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
  }

  async getUserById(userId: string): Promise<User | null> {
    this.checkFirebaseConfig();
    const doc = await withTimeoutAndRetry(() => this.collection!.doc(userId).get());

    if (!doc.exists) {
      return null;
    }

    return {
      uid: doc.id,
      ...doc.data(),
    } as User;
  }

  async updateUser(userId: string, userData: UpdateUserData): Promise<User> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(userId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('用戶不存在');
    }

    const updateData = {
      ...userData,
      updatedAt: Timestamp.now(),
    };

    await withTimeoutAndRetry(() => docRef.update(updateData));

    const updatedDoc = await withTimeoutAndRetry(() => docRef.get());
    return {
      uid: updatedDoc.id,
      ...updatedDoc.data(),
    } as User;
  }

  async createUser(userData: Omit<User, 'uid' | 'createdAt'>): Promise<User> {
    this.checkFirebaseConfig();
    const now = Timestamp.now();
    const newUser = {
      ...userData,
      createdAt: now,
    };

    const docRef = await withTimeoutAndRetry(() => this.collection!.add(newUser));

    return {
      uid: docRef.id,
      ...newUser,
    };
  }
}
