import Link from "next/link";
import { RescomLogo } from "@/components/brand/RescomLogo";
import GlassSurface from "@/components/ui/GlassSurface";
import { FadingLoopVideo } from "./FadingLoopVideo";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4";

// Fraunces, exposed as --font-display by app/page.tsx.
const DISPLAY_FONT = "font-(family-name:--font-display)";

export function AetheraHero({ fontClassName }: { fontClassName?: string }) {
  return (
    <div className={`${fontClassName ?? ""} relative min-h-screen w-full overflow-hidden bg-white antialiased`}>
      {/* Background video */}
      <div className="absolute inset-x-0 bottom-0 top-[300px] z-0" aria-hidden="true">
        <FadingLoopVideo src={VIDEO_SRC} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-white via-transparent to-white" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <Link href="/" aria-label="Rescom">
          <RescomLogo size="md" highPriority />
        </Link>
       
      </nav>

      {/* Hero */}
      <section
        className="relative z-10 flex flex-col items-center justify-center text-center px-6 pb-40"
        style={{ paddingTop: "calc(8rem - 75px)" }}
      >
        <h1
          className={`${DISPLAY_FONT} text-5xl sm:text-7xl md:text-8xl max-w-7xl font-normal text-[#000000] animate-fade-rise`}
          style={{ lineHeight: 0.95, letterSpacing: "-2.46px" }}
        >
          Từ <em className="text-[#6F6F6F]">câu hỏi,</em> đến những <em className="text-[#6F6F6F]">góc nhìn lớn hơn.</em>
        </h1>
        <p className="text-base sm:text-lg max-w-2xl mt-8 leading-relaxed text-[#6F6F6F] animate-fade-rise-delay">
          Tạo khảo sát, chia sẻ quan điểm và khám phá góc nhìn từ cộng đồng sinh viên. Mỗi câu trả lời đều góp phần
          tạo nên những hiểu biết có giá trị.
        </p>
        <Link
          href="/login"
          className="rounded-full text-base mt-12 text-[#000000] hover:scale-[1.03] transition-transform animate-fade-rise-delay-2"
        >
          <GlassSurface width={240} height={64} borderRadius={32}>
            Bắt đầu ngay
          </GlassSurface>
        </Link>
      </section>
    </div>
  );
}
