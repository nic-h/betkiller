"use client";

import Image from "next/image";
import Link from "next/link";
import useSWR from "swr";

type ProfilePayload = {
  username: string;
  profile_url: string;
  avatar_url?: string | null;
};

type AddressOrNameProps = {
  address: string;
  className?: string;
  showAvatar?: boolean;
};

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return (await response.json()) as ProfilePayload;
};

function shortAddress(address: string): string {
  if (!address.startsWith("0x")) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function joinClassNames(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function AddressOrName({ address, className, showAvatar = false }: AddressOrNameProps) {
  const lower = address.toLowerCase();
  const { data } = useSWR<ProfilePayload | null>(
    lower ? `/api/context-profile?wallet=${lower}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5 * 60 * 1000
    }
  );

  if (!data) {
    return (
      <span className={joinClassNames("bk-font-mono bk-text-sm", className)} title={address}>
        {shortAddress(address)}
      </span>
    );
  }

  const avatar = data.avatar_url;
  return (
    <Link
      href={data.profile_url}
      target="_blank"
      rel="noopener noreferrer"
      className={joinClassNames("bk-inline-flex bk-items-center bk-gap-2 bk-text-sm bk-text-sky-300", className)}
    >
      {showAvatar && avatar ? (
        <span className="bk-h-5 bk-w-5 bk-overflow-hidden bk-rounded-full">
          <Image src={avatar} alt={data.username} width={20} height={20} className="bk-h-full bk-w-full bk-object-cover" />
        </span>
      ) : null}
      <span>{data.username}</span>
    </Link>
  );
}
