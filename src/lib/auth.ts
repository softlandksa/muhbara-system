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
          console.error("AUTH_DATABASE_ERROR", dbError);
          throw new Error("database_error");
        }

        console.log("AUTH_USER_FOUND", !!user);
        console.log("AUTH_HAS_HASH", !!user?.passwordHash);

        if (!user) return null;

        if (!user.isActive) {
          console.log("AUTH_ACCOUNT_DISABLED", email);
          throw new Error("account_disabled");
        }

        if (!user.passwordHash) return null;

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        console.log("AUTH_PASSWORD_VALID", isValid);

        if (!isValid) return null;

        console.log("AUTH_SUCCESS", email, user.role);

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
    maxAge: 24 * 60 * 60, // 24 hours
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
