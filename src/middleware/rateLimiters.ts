import rateLimit from 'express-rate-limit';

export const venuesListLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many venue list requests, please try again later' },
});

export const venueDetailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many venue detail requests, please try again later' },
});

export const eventViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many event view requests, please try again later' },
});

export const venueViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many venue view requests, please try again later' },
});

export const venueSubmissionImageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many image uploads, please try again later' },
});

export const venueSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many venue submissions, please try again later' },
});

export const venueSubmissionPlacesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many place searches, please try again later' },
});
