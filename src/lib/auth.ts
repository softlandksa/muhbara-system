import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "البريد الإلكتروني", type: "email" },
        password: { label: "كلمة المرور", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.toLowerCase().trim();
        console.log("AUTH_EMAIL", email);

        // ── Database lookup ─────────────────────────────────────────────────
        let user;
        try {
          user = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              name: true,
              email: true,
              passwordHash: true,
              role: true,
              teamId: true,
              isActive: true,
            },
          });
        } catch (dbError) {
          // Log the actual exception so Vercel logs show the real cause.
          console.error("AUTH_ERROR_REAL", dbError);
          throw new Error("database_error");
        }

        console.log("AUTH_USER_FOUND", !!user);

        if (!user) {
          throw new Error("user_not_found");
        }

        if (!user.isActive) {
          console.log("AUTH_ACCOUNT_DISABLED", email);
          throw new Error("account_disabled");
        }

        console.log("AUTH_HAS_PASSWORD_HASH", !!user.passwordHash);

        if (!user.passwordHash) {
          console.error("AUTH_ERROR_REAL hash missing for", email);
          throw new Error("hash_missing");
        }

        // ── Password comparison ──────────────────────────────────────────────
        let isValid: boolean;
        try {
          isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        } catch (bcryptError) {
          console.error("AUTH_ERROR_REAL bcrypt failed:", bcryptError);
          throw new Error("auth_error");
        }

        console.log("AUTH_PASSWORD_VALID", isValid);

        if (!isValid) {
          throw new Error("invalid_password");
        }

        console.log("AUTH_SUCCESS", email, user.role);

        const returnUser = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          teamId: user.teamId,
        };
        console.log("AUTH_SUCCESS_RETURN_USER", JSON.stringify(returnUser));
        return returnUser;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
        const u = user as unknown as { role: Role; teamId: string | null };
        token.role = u.role;
        token.teamId = u.teamId;
        console.log("AUTH_JWT_CALLBACK_USER", token.id, token.role);
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
        session.user.role = token.role as Role;
        session.user.teamId = token.teamId as string | null;
        console.log("AUTH_SESSION_CALLBACK_TOKEN", token.id, token.role);
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Extend next-auth types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: Role;
      teamId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    teamId: string | null;
  }
}
