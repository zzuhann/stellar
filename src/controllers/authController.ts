import { Request, Response } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { auth } from '../config/firebase';
import { EventService } from '../services/eventService';
import {
  encodeState,
  decodeState,
  exchangeCodeForToken,
  getThreadsUsername,
  matchUsername,
  buildThreadsOAuthUrl,
} from '../services/oauthService';
import { oauthConfig } from '../config/oauth';
import { CoffeeEvent } from '../models/types';

const eventService = new EventService();

function buildRedirectUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

export class AuthController {
  async initiateThreadsOAuth(req: Request, res: Response): Promise<void> {
    try {
      const { eventId, redirectUrl, token } = req.query;

      // 從 query string 取得並驗證 token
      if (!token || typeof token !== 'string') {
        res.status(401).json({ error: 'Access token required' });
        return;
      }

      let userId: string;
      try {
        const decodedToken = await auth.verifyIdToken(token);
        userId = decodedToken.uid;
      } catch {
        res.status(403).json({ error: 'Invalid token' });
        return;
      }

      if (!eventId || typeof eventId !== 'string') {
        res.status(400).json({ error: 'eventId is required' });
        return;
      }

      // 驗證活動存在
      const event = (await eventService.getEventById(eventId)) as CoffeeEvent | null;
      if (!event) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      // 檢查是否已認領
      const hasClaimed = await eventService.hasUserClaimedEvent(eventId, userId);
      if (hasClaimed) {
        res.status(400).json({ error: 'Already claimed' });
        return;
      }

      // 決定完成後要跳轉的頁面
      const finalRedirectUrl =
        typeof redirectUrl === 'string'
          ? redirectUrl
          : `${oauthConfig.frontendUrl}/events/${eventId}`;

      // 編碼 state
      const state = encodeState({
        eventId,
        userId,
        redirectUrl: finalRedirectUrl,
      });

      // 建立 OAuth URL 並重導向
      const oauthUrl = buildThreadsOAuthUrl(state);
      res.redirect(oauthUrl);
    } catch (error) {
      console.error('initiateThreadsOAuth error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async handleThreadsCallback(req: Request, res: Response): Promise<void> {
    let redirectUrl = oauthConfig.frontendUrl;

    try {
      const { code, state, error } = req.query;

      // 先解碼 state 取得 redirectUrl
      if (state && typeof state === 'string') {
        try {
          const decoded = decodeState(state);
          redirectUrl = decoded.redirectUrl;
        } catch {
          // state 解碼失敗，使用預設 redirectUrl
        }
      }

      // 用戶取消授權
      if (error) {
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'cancelled',
          })
        );
        return;
      }

      if (!code || typeof code !== 'string') {
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'oauth_failed',
          })
        );
        return;
      }

      if (!state || typeof state !== 'string') {
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'oauth_failed',
          })
        );
        return;
      }

      // 解碼並驗證 state
      let decodedState;
      try {
        decodedState = decodeState(state);
        redirectUrl = decodedState.redirectUrl;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        if (errorMessage === 'State expired') {
          res.redirect(
            buildRedirectUrl(redirectUrl, {
              claim: 'error',
              reason: 'state_expired',
            })
          );
          return;
        }
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'oauth_failed',
          })
        );
        return;
      }

      const { eventId, userId } = decodedState;

      // 驗證活動存在
      const event = (await eventService.getEventById(eventId)) as CoffeeEvent | null;
      if (!event) {
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'event_not_found',
          })
        );
        return;
      }

      // 檢查是否已認領
      const hasClaimed = await eventService.hasUserClaimedEvent(eventId, userId);
      if (hasClaimed) {
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'already_claimed',
          })
        );
        return;
      }

      // 交換 token
      let accessToken: string;
      try {
        accessToken = await exchangeCodeForToken(code);
      } catch {
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'oauth_failed',
          })
        );
        return;
      }

      // 取得 username
      let username: string;
      try {
        username = await getThreadsUsername(accessToken);
      } catch {
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'oauth_failed',
          })
        );
        return;
      }

      // 比對 username
      const isMatch = matchUsername(username, event.socialMedia);
      if (!isMatch) {
        res.redirect(
          buildRedirectUrl(redirectUrl, {
            claim: 'error',
            reason: 'username_mismatch',
          })
        );
        return;
      }

      // 寫入 verifiedOrganizers
      await eventService.addVerifiedOrganizer(eventId, {
        userId,
        platform: 'threads',
        username: username.toLowerCase(),
        verifiedAt: Timestamp.now(),
      });

      // 成功，redirect 到前端
      res.redirect(
        buildRedirectUrl(redirectUrl, {
          claim: 'success',
          platform: 'threads',
        })
      );
    } catch (error) {
      console.error('handleThreadsCallback error:', error);
      res.redirect(
        buildRedirectUrl(redirectUrl, {
          claim: 'error',
          reason: 'oauth_failed',
        })
      );
    }
  }
}
