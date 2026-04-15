'use strict';

/**
 * Thin wrapper around the X (Twitter) v2 API.
 * All credentials are read from environment variables — never from client-side code.
 */

const { TwitterApi } = require('twitter-api-v2');

function getXClient() {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    throw new Error('[x-client] Missing one or more X API credentials in environment variables');
  }
  return new TwitterApi({
    appKey:      X_API_KEY,
    appSecret:   X_API_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessSecret: X_ACCESS_TOKEN_SECRET,
  });
}

/**
 * Post a tweet using the X v2 API.
 * @param {string} text - Full post text (copy + URL, already assembled and validated)
 * @returns {Promise<{ id: string, text: string }>}
 */
async function postTweet(text) {
  const client = getXClient();
  const { data } = await client.v2.tweet(text);
  return data; // { id: '...', text: '...' }
}

module.exports = { postTweet };
