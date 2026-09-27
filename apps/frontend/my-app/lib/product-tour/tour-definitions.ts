import type { ProductTourId } from "@rescom/schemas";

/**
 * Interactive product tours — Design canvas section 20 ("Hướng dẫn tương tác",
 * desktop). Pure data: the provider and overlay in `components/product-tour`
 * read it; `tour-logic.ts` holds the rules. Keep steps short (≤ 6).
 *
 * A step is shown when the current pathname matches `route` AND an element
 * `[data-tour="<target>"]` is on screen. Until then the tour waits silently,
 * so a step that lives deeper in a flow (the wizard's audience step, the code
 * screen after a Google Form) appears on its own when the user gets there.
 */

export type TourStepKind =
  /** Has a "Tiếp" button. */
  | "info"
  /** No "Tiếp": advances when the user clicks inside the lit element. */
  | "action"
  /** Last step: "Xong" completes the tour. */
  | "final";

export type TourPlacement = "top" | "bottom" | "left" | "right";

/** Mascot artwork name (`public/brand/mascots/<name>.svg`), see `components/brand/Mascot.tsx`. */
export type TourMascot = "points" | "create" | "search" | "trophy" | "wave";

export interface TourStep {
  route: RegExp;
  /** Value of the `data-tour` attribute on the element to light up. */
  target: string;
  kind: TourStepKind;
  placement: TourPlacement;
  title: string;
  body: string;
  /** Numbered list under the body (canvas 20A.2). */
  points?: readonly string[];
  /** Action steps: what to click to go on. */
  hint?: string;
  mascot?: TourMascot;
  /** Skip this step when its target does not show up (e.g. the banner is gone after activation). */
  optional?: boolean;
}

export interface TourDefinition {
  id: ProductTourId;
  title: string;
  /** One line under the title in the Trung tâm hướng dẫn. */
  summary: string;
  /** Where "Bắt đầu" in the hub takes the user. */
  startHref: string;
  steps: readonly TourStep[];
}

const MARKETPLACE = /^\/marketplace\/?$/;
const GOOGLE_FORM_ATTEMPT = /^\/attempts\/[^/]+\/google-form\/?$/;
const WALLET = /^\/wallet\/?$/;
const FORMS_NEW = /^\/forms\/new\/?$/;
const GOOGLE_FORM_WIZARD = /^\/forms\/new\/google-form\/?$/;
const FORM_SUBMITTED = /^\/forms\/[^/]+\/submitted\/?$/;
const FORM_PROGRESS = /^\/forms\/(?!new(?:\/|$))[^/]+\/?$/;
const BUILDER = /^\/forms\/[^/]+\/builder\/?$/;
const BUILDER_PREVIEW = /^\/forms\/[^/]+\/builder\/preview\/?$/;

/** 20A — take a first survey and unlock the starter points. */
const FIRST_SURVEY: TourDefinition = {
  id: "FIRST_SURVEY",
  title: "Làm khảo sát đầu tiên",
  summary: "Mở khoá 100 điểm khởi đầu",
  startHref: "/marketplace",
  steps: [
    {
      route: MARKETPLACE,
      target: "activation-banner",
      kind: "info",
      placement: "bottom",
      mascot: "points",
      optional: true,
      title: "100 điểm khởi đầu đang chờ bạn",
      body: "Số điểm này đang đóng băng. Làm xong 1 khảo sát bất kỳ là mở khoá, dùng được ngay để đăng khảo sát của bạn.",
    },
    {
      route: MARKETPLACE,
      target: "survey-card",
      kind: "info",
      placement: "right",
      title: "Mỗi thẻ cho bạn biết 3 điều",
      body: "Xem nhanh trước khi bấm Bắt đầu:",
      points: [
        "Nơi làm: ngay trong Rescom, hoặc mở Google Forms.",
        "Số điểm bạn nhận khi hoàn thành.",
        "Thời lượng và số suất còn lại. Hết suất là khảo sát ngừng nhận người.",
      ],
    },
    {
      route: MARKETPLACE,
      target: "survey-start",
      kind: "action",
      placement: "bottom",
      title: "Thử với khảo sát này",
      body: "Rescom mở khảo sát cho bạn. Chọn thẻ khác cũng được, hướng dẫn đi theo bạn.",
      hint: "Bấm Bắt đầu trên thẻ đang sáng để đi tiếp.",
    },
    {
      route: GOOGLE_FORM_ATTEMPT,
      target: "gf-steps",
      kind: "info",
      placement: "bottom",
      title: "Làm trên Google Forms, lấy mã ở trang cuối",
      body: "Làm hết form rồi bấm Gửi. Trang cảm ơn hiện một mã 6 số: chép lại và quay về tab Rescom này.",
    },
    {
      route: GOOGLE_FORM_ATTEMPT,
      target: "gf-code",
      kind: "info",
      placement: "left",
      title: "Dán mã 6 số vào đây",
      body: "Nút xác nhận mở khi đồng hồ chạy hết, để chắc bạn đã dành đủ thời gian cho form. Nhập sai 3 lần thì lượt làm bị khoá.",
    },
    {
      route: WALLET,
      target: "wallet-buckets",
      kind: "final",
      placement: "right",
      title: "Điểm Google Forms chờ 48 giờ",
      body: "Điểm từ khảo sát Google Forms nằm ở Chờ duyệt: người đăng có 48 giờ để khiếu nại nếu lượt làm không hợp lệ. Hết giờ, điểm tự chuyển sang Khả dụng. Khảo sát trong Rescom thì cộng ngay.",
    },
  ],
};

/** 20B — publish a first Google Forms survey. */
const FIRST_PUBLISH: TourDefinition = {
  id: "FIRST_PUBLISH",
  title: "Đăng khảo sát đầu tiên",
  summary: "Từ link Google Forms đến mã hoàn thành",
  startHref: "/wallet",
  steps: [
    {
      route: WALLET,
      target: "wallet-create-survey",
      kind: "action",
      placement: "right",
      mascot: "create",
      title: "Dùng điểm để có người trả lời",
      body: "Bạn khoá trước một phần điểm vào Ký quỹ. Mỗi người hoàn thành khảo sát của bạn nhận điểm từ phần đó.",
      hint: "Bấm Tạo khảo sát bằng điểm để bắt đầu.",
    },
    {
      route: FORMS_NEW,
      target: "create-methods",
      kind: "action",
      placement: "bottom",
      title: "Chọn cách tạo khảo sát",
      body: "Link Google Forms: dán form có sẵn, điểm của người trả lời chờ 48 giờ. Tạo form trong Rescom: rẻ hơn 20%, điểm trả ngay và bạn xem câu trả lời tại chỗ.",
      hint: "Chọn một cách để đi tiếp. Hướng dẫn này đi theo Google Forms.",
    },
    {
      route: GOOGLE_FORM_WIZARD,
      target: "audience-estimate",
      kind: "info",
      placement: "left",
      title: "Chọn ai được thấy khảo sát",
      body: "Chỉ người có hồ sơ khớp tiêu chí mới thấy khảo sát trong Khám phá. Ô này ước tính số người phù hợp, con số quá nhỏ thì nới bớt tiêu chí.",
    },
    {
      route: GOOGLE_FORM_WIZARD,
      target: "escrow-summary",
      kind: "info",
      placement: "left",
      title: "Điểm được giữ trong Ký quỹ",
      body: "Rescom khoá trước số người × điểm mỗi lượt. Chỉ khi có người hoàn thành mới trừ; hết hạn hoặc đóng sớm thì phần chưa dùng tự về lại ví.",
    },
    {
      route: FORM_SUBMITTED,
      target: "completion-code",
      kind: "final",
      placement: "bottom",
      title: "Việc cuối: dán mã vào Google Form",
      body: "Mã chỉ hiện một lần. Chép dòng mã, dán vào Tin nhắn xác nhận của form rồi gửi thử một lần để thấy mã ở trang cảm ơn. Admin duyệt xong, khảo sát lên Khám phá.",
    },
  ],
};

/** 20C — read the progress page of a running survey. */
const TRACK_SURVEY: TourDefinition = {
  id: "TRACK_SURVEY",
  title: "Theo dõi & khiếu nại",
  summary: "Mở trang Theo dõi của một khảo sát đang chạy",
  startHref: "/forms",
  steps: [
    {
      route: FORM_PROGRESS,
      target: "form-kpis",
      kind: "info",
      placement: "bottom",
      title: "Tiến độ và điểm nằm trên một hàng",
      body: "Số người đã hoàn thành trên số cần, điểm đã chi, Ký quỹ còn lại (hoàn về ví nếu không dùng hết) và thời hạn thu thập.",
    },
    {
      route: FORM_PROGRESS,
      target: "pending-attempts",
      kind: "info",
      placement: "left",
      optional: true,
      title: "48 giờ để khiếu nại lượt làm đáng ngờ",
      body: "Mỗi lượt nhập mã được giữ 48 giờ trước khi điểm chuyển cho người trả lời. Thấy lượt làm không hợp lệ thì bấm Khiếu nại trước khi hết giờ, Admin sẽ xem xét.",
    },
    {
      route: FORM_PROGRESS,
      target: "form-actions",
      kind: "final",
      placement: "bottom",
      title: "Đóng sớm khi đã đủ dữ liệu",
      body: "Đóng & hoàn điểm kết thúc khảo sát ngay, phần Ký quỹ chưa dùng về lại ví.",
    },
  ],
};

/** 20D — build a form in the drag-and-drop builder. The AI button is never lit (Phase 1). */
const FORM_BUILDER: TourDefinition = {
  id: "FORM_BUILDER",
  title: "Soạn form bằng Form Builder",
  summary: "Kéo thả câu hỏi, câu kiểm tra chú ý",
  startHref: "/forms/new",
  steps: [
    {
      route: FORMS_NEW,
      target: "create-method-builder",
      kind: "action",
      placement: "bottom",
      mascot: "create",
      title: "Tạo form ngay trong Rescom",
      body: "Rescom tạo một bản nháp tự lưu. Bạn thêm câu hỏi, xem trước rồi mới gửi duyệt.",
      hint: "Bấm Tạo form trong Rescom để mở Form Builder.",
    },
    {
      route: BUILDER,
      target: "builder-toolbox",
      kind: "info",
      placement: "right",
      title: "Thêm câu hỏi từ cột trái",
      body: "Kéo một loại câu hỏi vào form, hoặc bấm vào nó để thêm vào cuối form.",
    },
    {
      route: BUILDER,
      target: "builder-canvas",
      kind: "info",
      placement: "right",
      title: "Kéo tay nắm để đổi thứ tự",
      body: "Giữ tay nắm sáu chấm bên trái câu hỏi rồi kéo. Vạch xanh cho biết câu sẽ nằm ở đâu, số thứ tự tự cập nhật.",
    },
    {
      route: BUILDER,
      target: "builder-properties",
      kind: "info",
      placement: "left",
      title: "Thêm một câu kiểm tra chú ý",
      body: "Câu có đáp án đúng rõ ràng giúp lọc người trả lời bừa. Chọn câu đó rồi bật Là câu kiểm tra chú ý trong phần Chất lượng dữ liệu. Form nên có ít nhất 1 câu.",
    },
    {
      route: BUILDER,
      target: "builder-preview",
      kind: "action",
      placement: "bottom",
      title: "Xem trước như người trả lời",
      body: "Thử form trên khung điện thoại hoặc máy tính trước khi gửi duyệt.",
      hint: "Bấm Xem trước để đi tiếp.",
    },
    {
      route: BUILDER_PREVIEW,
      target: "preview-quality",
      kind: "final",
      placement: "left",
      title: "Người trả lời cũng thấy khung này",
      body: "Khung này liệt kê dữ liệu chất lượng Rescom ghi lại khi làm form. Người trả lời đọc nó trước câu đầu tiên.",
    },
  ],
};

/** Hub order (canvas 20.2). */
export const TOURS: readonly TourDefinition[] = [FIRST_SURVEY, FIRST_PUBLISH, FORM_BUILDER, TRACK_SURVEY];

export function tourById(id: ProductTourId): TourDefinition {
  const tour = TOURS.find((item) => item.id === id);
  if (!tour) throw new Error(`Unknown product tour ${id}`);
  return tour;
}

/** Routes whose first visit shows a small invite (canvas 20C.0) instead of starting a tour. */
export const CONTEXT_INVITES: readonly { tourId: ProductTourId; route: RegExp; target: string; title: string; body: string }[] = [
  {
    tourId: "TRACK_SURVEY",
    route: FORM_PROGRESS,
    target: "form-kpis",
    title: "Lần đầu xem tiến độ?",
    body: "Đi nhanh 3 chỗ quan trọng: số liệu, 48 giờ khiếu nại và nút đóng sớm.",
  },
  {
    tourId: "FORM_BUILDER",
    route: BUILDER,
    target: "builder-toolbox",
    title: "Lần đầu dùng Form Builder?",
    body: "Xem cách thêm câu, đổi thứ tự và đặt câu kiểm tra chú ý trong 4 bước.",
  },
];
