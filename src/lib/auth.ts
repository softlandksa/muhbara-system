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
          throw new Error("auth_error");
        }

        const email = credentials.email.toLowerCase().trim();
        console.log("[AUTH] Login attempt:", email);

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
          console.error("[AUTH] AUTH_DATABASE_ERROR:", dbError);
          throw new Error("database_error");
        }

        if (!user) {
          console.log("[AUTH] AUTH_USER_NOT_FOUND:", email);
          throw new Error("user_not_found");
        }

        if (!user.isActive) {
          console.log("[AUTH] AUTH_ACCOUNT_DISABLED:", email);
          throw new Error("auth_error");
        }

        if (!user.passwordHash) {
          console.error("[AUTH] AUTH_PASSWORD_HASH_MISSING:", email);
          throw new Error("auth_error");
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) {
          console.log("[AUTH] AUTH_INVALID_PASSWORD:", email);
          throw new Error("invalid_password");
        }

        console.log("[AUTH] AUTH_SUCCESS:", email, "role:", user.role);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          teamId: user.teamId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        const u = user as unknown as { role: Role; teamId: string | null };
        token.role = u.role;
        token.teamId = u.teamId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.teamId = token.teamId as string | null;
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
