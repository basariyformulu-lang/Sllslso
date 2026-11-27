import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { extractInstagramUsername } from '@/lib/booking-helpers';

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.design');
  if (error || !ctx) return error!;

  let body: { instagramInput?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const username = extractInstagramUsername(body.instagramInput);
  if (!username) {
    return NextResponse.json(
      { error: 'Lütfen geçerli bir Instagram kullanıcı adı veya profil bağlantısı girin.' },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-IG-App-ID': '936619743392459',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (res.ok) {
      const json = (await res.json()) as {
        data?: {
          user?: {
            username?: string;
            full_name?: string;
            profile_pic_url_hd?: string;
            profile_pic_url?: string;
            edge_followed_by?: { count?: number };
            edge_owner_to_timeline_media?: {
              count?: number;
              edges?: Array<{
                node?: {
                  id?: string;
                  shortcode?: string;
                  display_url?: string;
                  thumbnail_src?: string;
                  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
                };
              }>;
            };
          };
        };
      };

      const user = json?.data?.user;
      if (user) {
        const edges = user.edge_owner_to_timeline_media?.edges ?? [];
        const posts = edges.slice(0, 6).map((e, idx) => ({
          id: e.node?.id || `ig-${idx + 1}`,
          image_url: e.node?.thumbnail_src || e.node?.display_url || '',
          caption: e.node?.edge_media_to_caption?.edges?.[0]?.node?.text?.slice(0, 200) || '',
          post_url: e.node?.shortcode
            ? `https://www.instagram.com/p/${e.node.shortcode}/`
            : `https://www.instagram.com/${username}/`,
        })).filter((p) => p.image_url);

        return NextResponse.json({
          fetched: true,
          profile: {
            instagram_url: `https://www.instagram.com/${user.username || username}/`,
            instagram_username: user.username || username,
            instagram_display_name: user.full_name || user.username || username,
            instagram_avatar_url: user.profile_pic_url_hd || user.profile_pic_url || '',
            instagram_followers_count: Number(user.edge_followed_by?.count ?? 0),
            instagram_posts_count: Number(user.edge_owner_to_timeline_media?.count ?? 0),
            instagram_posts: posts,
          },
        });
      }
    }
  } catch {
    // Instagram rate-limit / block durumlarında kullanıcıya düzenli manuel düzenleme bilgisi döner
  }

  return NextResponse.json({
    fetched: false,
    profile: {
      instagram_url: `https://www.instagram.com/${username}/`,
      instagram_username: username,
    },
    message:
      'Instagram otomatik veri erişimi geçici olarak kısıtlandı. Profil adı, takipçi sayısı ve son 6 gönderi görsellerini aşağıdan doğrudan ekleyebilirsiniz.',
  });
}
