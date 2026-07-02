// Thin wrapper over AWS Amplify's Cognito auth. Configured from build-time env
// (VITE_COGNITO_*). Everything the app needs is exposed through `authApi` so no
// component imports Amplify directly.
import { Amplify } from "aws-amplify";
import {
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  resendSignUpCode,
  fetchAuthSession,
} from "aws-amplify/auth";

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "";
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";

export const AUTH_CONFIGURED = Boolean(USER_POOL_ID && CLIENT_ID);

if (AUTH_CONFIGURED) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: USER_POOL_ID,
        userPoolClientId: CLIENT_ID,
      },
    },
  });
}

export interface Session {
  sub: string;
  idToken: string;
}

export const authApi = {
  configured: AUTH_CONFIGURED,

  async signUp(email: string, password: string): Promise<{ needsConfirm: boolean }> {
    const res = await amplifySignUp({
      username: email,
      password,
      options: { userAttributes: { email } },
    });
    return { needsConfirm: !res.isSignUpComplete };
  },

  async confirm(email: string, code: string): Promise<void> {
    await amplifyConfirmSignUp({ username: email, confirmationCode: code });
  },

  async resendCode(email: string): Promise<void> {
    await resendSignUpCode({ username: email });
  },

  async signIn(email: string, password: string): Promise<void> {
    await amplifySignIn({ username: email, password });
  },

  async signOut(): Promise<void> {
    await amplifySignOut();
  },

  // Returns the current session (sub + raw ID token) or null if signed out.
  async getSession(): Promise<Session | null> {
    if (!AUTH_CONFIGURED) return null;
    try {
      const s = await fetchAuthSession();
      const idToken = s.tokens?.idToken;
      if (!idToken) return null;
      return { sub: String(idToken.payload.sub), idToken: idToken.toString() };
    } catch {
      return null;
    }
  },
};
