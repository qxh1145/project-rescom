// seed-50.js: Seed 10 users and 50 realistic surveys across 9 topics into RESCOM PostgreSQL
// Writes rows only, never ledger balances: run deploy/fund-seed-escrow.js
// (APPLY=1) right after, or every completion fails with INSUFFICIENT_ESCROW_BALANCE.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const TOPICS = [
  "IT",
  "MARKETING",
  "BUSINESS",
  "MENTAL_HEALTH",
  "EDUCATION",
  "ARTS_MUSIC",
  "SCHOOL_PSYCHOLOGY",
  "RESEARCH",
  "OTHER",
];

const SEED_USERS = [
  {
    email: "nguyen.minh.triet@rescom.vn",
    displayName: "Nguyễn Minh Triết",
    birthYear: 2004,
    school: "Trường Đại học FPT – Đà Nẵng",
    schoolYear: "Năm 3",
    fieldOfStudy: "Công nghệ thông tin",
    gender: "MALE",
    location: "Đà Nẵng",
  },
  {
    email: "tran.bao.ngoc@rescom.vn",
    displayName: "Trần Bảo Ngọc",
    birthYear: 2005,
    school: "Trường Đại học FPT – Hà Nội",
    schoolYear: "Năm 2",
    fieldOfStudy: "Marketing & Truyền thông",
    gender: "FEMALE",
    location: "Hà Nội",
  },
  {
    email: "le.hoang.nam@rescom.vn",
    displayName: "Lê Hoàng Nam",
    birthYear: 2003,
    school: "Trường Đại học FPT – TP. Hồ Chí Minh",
    schoolYear: "Năm 4",
    fieldOfStudy: "Kinh tế & Quản trị kinh doanh",
    gender: "MALE",
    location: "TP. Hồ Chí Minh",
  },
  {
    email: "pham.thanh.thao@rescom.vn",
    displayName: "Phạm Thanh Thảo",
    birthYear: 2005,
    school: "Trường Đại học FPT – Cần Thơ",
    schoolYear: "Năm 2",
    fieldOfStudy: "Thiết kế đồ họa & Mỹ thuật",
    gender: "FEMALE",
    location: "Cần Thơ",
  },
  {
    email: "hoang.quoc.anh@rescom.vn",
    displayName: "Hoàng Quốc Anh",
    birthYear: 2004,
    school: "Trường Đại học FPT – Đà Nẵng",
    schoolYear: "Năm 3",
    fieldOfStudy: "Kỹ thuật & Kiến trúc",
    gender: "MALE",
    location: "Đà Nẵng",
  },
  {
    email: "vu.khanh.linh@rescom.vn",
    displayName: "Vũ Khánh Linh",
    birthYear: 2005,
    school: "Trường Đại học FPT – Hà Nội",
    schoolYear: "Năm 2",
    fieldOfStudy: "Ngôn ngữ & Khoa học xã hội",
    gender: "FEMALE",
    location: "Hà Nội",
  },
  {
    email: "dang.tuan.kiet@rescom.vn",
    displayName: "Đặng Tuấn Kiệt",
    birthYear: 2004,
    school: "Trường Đại học FPT – TP. Hồ Chí Minh",
    schoolYear: "Năm 3",
    fieldOfStudy: "Công nghệ thông tin",
    gender: "MALE",
    location: "TP. Hồ Chí Minh",
  },
  {
    email: "bui.mai.phuong@rescom.vn",
    displayName: "Bùi Mai Phương",
    birthYear: 2006,
    school: "Trường Đại học FPT – Đà Nẵng",
    schoolYear: "Năm 1",
    fieldOfStudy: "Y sinh & Sức khỏe",
    gender: "FEMALE",
    location: "Đà Nẵng",
  },
  {
    email: "ngo.duc.huy@rescom.vn",
    displayName: "Ngô Đức Huy",
    birthYear: 2003,
    school: "Trường Đại học FPT – Hà Nội",
    schoolYear: "Năm 4",
    fieldOfStudy: "Kinh tế & Quản trị kinh doanh",
    gender: "MALE",
    location: "Hà Nội",
  },
  {
    email: "do.thu.ha@rescom.vn",
    displayName: "Đỗ Thu Hà",
    birthYear: 2004,
    school: "Trường Đại học FPT – Cần Thơ",
    schoolYear: "Năm 3",
    fieldOfStudy: "Marketing & Truyền thông",
    gender: "FEMALE",
    location: "Cần Thơ",
  },
];

const SURVEY_TEMPLATES = [
  {
    topic: "IT",
    title: "Khảo sát mức độ ứng dụng AI (ChatGPT, Copilot) trong học tập của sinh viên công nghệ",
    description: "Nghiên cứu về tần suất, mục đích và hiệu quả thực tế khi sinh viên CNTT sử dụng trợ lý AI trong viết code, giải bài tập và làm đồ án chuyên ngành.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 60,
  },
  {
    topic: "MARKETING",
    title: "Đánh giá tác động của mạng xã hội TikTok đến hành vi mua sắm của Gen Z",
    description: "Tìm hiểu mức độ ảnh hưởng của TikTok Video, TikTok Shop và các nhà sáng tạo nội dung đến quyết định chi tiêu hàng tháng của sinh viên.",
    estimatedDurationMinutes: 10,
    rewardPerResponse: 20,
    expectedCompletions: 80,
  },
  {
    topic: "BUSINESS",
    title: "Khảo sát thói quen quản lý tài chính cá nhân và đầu tư của sinh viên đại học",
    description: "Khảo sát các kênh phân bổ chi tiêu, phương pháp tiết kiệm và mức độ quan tâm đến chứng khoán, chứng chỉ quỹ trong giới trẻ.",
    estimatedDurationMinutes: 10,
    rewardPerResponse: 20,
    expectedCompletions: 70,
  },
  {
    topic: "MENTAL_HEALTH",
    title: "Nghiên cứu thực trạng chất lượng giấc ngủ và mức độ căng thẳng học đường",
    description: "Khảo sát thời gian ngủ trung bình, các yếu tố gây mất ngủ (deadline, điện thoại) và các biện pháp phục hồi sức khỏe tinh thần.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 50,
  },
  {
    topic: "EDUCATION",
    title: "Khảo sát nhu cầu sử dụng ứng dụng tìm phòng trọ thông minh tại các thành phố lớn",
    description: "Đánh giá những khó khăn thường gặp khi tìm kiếm nhà trọ, chia phòng ở ghép và các tiêu chí an ninh, giá cả ưu tiên.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 100,
  },
  {
    topic: "ARTS_MUSIC",
    title: "Trải nghiệm người dùng đối với các ứng dụng ngân hàng số tại Việt Nam",
    description: "Đánh giá mức độ thân thiện, tốc độ xử lý và tính trực quan của giao diện UI/UX trên các ứng dụng Vietcombank, MB Bank, Techcombank.",
    estimatedDurationMinutes: 9,
    rewardPerResponse: 15,
    expectedCompletions: 60,
  },
  {
    topic: "SCHOOL_PSYCHOLOGY",
    title: "Đánh giá hiệu quả các phương pháp tự học Tiếng Anh giao tiếp cho người mới bắt đầu",
    description: "Tìm hiểu các trở ngại tâm lý khi nói tiếng Anh, các app học tập phổ biến (Duolingo, ELSA) và thời gian tự học mỗi ngày.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 55,
  },
  {
    topic: "RESEARCH",
    title: "Khảo sát xu hướng lựa chọn xe máy điện thay thế xe xăng trong giới trẻ",
    description: "Khảo sát nhận thức về môi trường, sự tiện lợi của trạm sạc và các rào cản chi phí khi chuyển sang sử dụng xe điện.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 45,
  },
  {
    topic: "OTHER",
    title: "Nhận thức và hành vi tiêu dùng xanh, giảm thiểu rác thải nhựa của giới trẻ",
    description: "Tìm hiểu thói quen sử dụng ly cá nhân, túi vải và sự sẵn sàng chi trả thêm cho các sản phẩm bao bì thân thiện với môi trường.",
    estimatedDurationMinutes: 5,
    rewardPerResponse: 10,
    expectedCompletions: 80,
  },
  {
    topic: "IT",
    title: "Nghiên cứu xu hướng học lập trình Web & Cloud Computing năm 2026",
    description: "Khảo sát các framework phổ biến (Next.js, NestJS), nền tảng đám mây được ưa chuộng và định hướng nghề nghiệp sau khi tốt nghiệp.",
    estimatedDurationMinutes: 12,
    rewardPerResponse: 25,
    expectedCompletions: 50,
  },
  {
    topic: "MARKETING",
    title: "Khảo sát mức độ hài lòng về dịch vụ giao đồ ăn trực tuyến (ShopeeFood, GrabFood)",
    description: "Đánh giá thời gian giao hàng, thái độ shipper, chính sách khuyến mãi và tần suất đặt đồ ăn ngoài của sinh viên.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 90,
  },
  {
    topic: "BUSINESS",
    title: "Nhu cầu tham gia các dự án khởi nghiệp đổi mới sáng tạo tại trường đại học",
    description: "Tìm hiểu mong muốn xây dựng sản phẩm thực tế, kỹ năng cần hỗ trợ (marketing, pitching) và tìm kiếm cộng sự đồng hành.",
    estimatedDurationMinutes: 10,
    rewardPerResponse: 20,
    expectedCompletions: 40,
  },
  {
    topic: "MENTAL_HEALTH",
    title: "Khảo sát thói quen tập luyện thể thao và rèn luyện thể chất của sinh viên",
    description: "Khảo sát các bộ môn thể thao được yêu thích (gym, chạy bộ, cầu lông) và rào cản thời gian trong quá trình duy trì tập luyện.",
    estimatedDurationMinutes: 5,
    rewardPerResponse: 10,
    expectedCompletions: 75,
  },
  {
    topic: "EDUCATION",
    title: "Thực trạng và nhu cầu làm thêm (Part-time) của sinh viên năm 1 và năm 2",
    description: "Tìm hiểu mức thu nhập kỳ vọng, sự cân bằng giữa học tập và đi làm thêm, cùng các kỹ năng thực tế tích lũy được.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 80,
  },
  {
    topic: "ARTS_MUSIC",
    title: "Khảo sát thẩm mỹ giao diện phẳng (Flat Design) và Neumorphism trong thiết kế UI",
    description: "Đánh giá xu hướng thẩm mỹ thị giác hiện đại, mức độ thu hút thị giác và khả năng ứng dụng thực tế trên thiết bị di động.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 50,
  },
  {
    topic: "SCHOOL_PSYCHOLOGY",
    title: "Đánh giá sự tự tin khi thuyết trình trước đám đông của sinh viên các khối ngành",
    description: "Khảo sát hội chứng sợ nói trước đám đông, phương pháp luyện tập chuẩn bị slide và phản xạ trả lời câu hỏi phản biện.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 70,
  },
  {
    topic: "RESEARCH",
    title: "Khảo sát ứng dụng Internet of Things (IoT) trong các khu ký túc xá thông minh",
    description: "Khảo sát nhu cầu quản lý điện nước tự động, hệ thống khóa cửa vân tay và giám sát phòng cháy chữa cháy thông minh.",
    estimatedDurationMinutes: 9,
    rewardPerResponse: 15,
    expectedCompletions: 40,
  },
  {
    topic: "OTHER",
    title: "Thói quen đọc sách và tiêu thụ nội dung Podcast của giới trẻ hiện nay",
    description: "Tìm hiểu các chủ đề Podcast được nghe nhiều nhất khi di chuyển, các thể loại sách kỹ năng sống và thời gian nghe mỗi tuần.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 65,
  },
  {
    topic: "IT",
    title: "Trải nghiệm sử dụng các công cụ lập trình hỗ trợ bằng trí tuệ nhân tạo (Cursor, Copilot)",
    description: "Đánh giá tốc độ hoàn thành bài tập lập trình, khả năng sửa lỗi (debugging) và sự thay đổi trong tư duy giải thuật.",
    estimatedDurationMinutes: 10,
    rewardPerResponse: 20,
    expectedCompletions: 50,
  },
  {
    topic: "MARKETING",
    title: "Khảo sát độ nhận diện thương hiệu thời trang nội địa (Local Brands) Việt Nam",
    description: "Khảo sát lý do lựa chọn thương hiệu trong nước: chất liệu, thiết kế cá tính, giá thành hay hình ảnh đại diện của KOLs.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 85,
  },
  {
    topic: "BUSINESS",
    title: "Nghiên cứu về xu hướng thanh toán không dùng tiền mặt qua mã QR tại Việt Nam",
    description: "Khảo sát tần suất quét mã VietQR, chuyển khoản nhanh và sự tiện lợi khi không còn mang theo tiền mặt trong ví.",
    estimatedDurationMinutes: 5,
    rewardPerResponse: 10,
    expectedCompletions: 100,
  },
  {
    topic: "MENTAL_HEALTH",
    title: "Thực trạng sử dụng đồ uống có đường và nhận thức về sức khỏe ở người trẻ",
    description: "Khảo sát thói quen uống trà sữa, nước ngọt có ga và mức độ quan tâm đến bệnh lý tiểu đường, tim mạch giai đoạn sớm.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 90,
  },
  {
    topic: "EDUCATION",
    title: "Khảo sát sự thích nghi tâm lý của tân sinh viên khi bắt đầu cuộc sống xa nhà",
    description: "Đánh giá cảm giác nhớ nhà, khả năng tự lập quản lý chi tiêu và các mối quan hệ bạn bè mới trong những tháng đầu tiên.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 60,
  },
  {
    topic: "ARTS_MUSIC",
    title: "Nghiên cứu trải nghiệm người dùng trên các nền tảng thương mại điện tử",
    description: "Đánh giá quy trình tìm kiếm sản phẩm, xem đánh giá người mua và thanh toán đơn hàng trên Shopee, Lazada và TikTok Shop.",
    estimatedDurationMinutes: 10,
    rewardPerResponse: 20,
    expectedCompletions: 55,
  },
  {
    topic: "SCHOOL_PSYCHOLOGY",
    title: "Tác động của ngoại ngữ thứ hai (Nhật, Hàn, Trung) đến cơ hội việc làm sau tốt nghiệp",
    description: "Tìm hiểu động lực học thêm ngôn ngữ mới, các chứng chỉ hướng tới (JLPT, TOPIK, HSK) và mức lương kỳ vọng.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 50,
  },
  {
    topic: "RESEARCH",
    title: "Khảo sát xu hướng ứng dụng năng lượng mặt trời tại các hộ gia đình đô thị",
    description: "Đánh giá sự am hiểu về hệ thống điện mặt trời áp mái, chi phí đầu tư ban đầu và khả năng tiết kiệm hóa đơn tiền điện.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 40,
  },
  {
    topic: "OTHER",
    title: "Sở thích du lịch tự túc và xu hướng 'du lịch chữa lành' của sinh viên",
    description: "Khảo sát ngân sách cho một chuyến đi, địa điểm yêu thích (Đà Lạt, Hội An, Quy Nhơn) và hình thức phượt cùng nhóm bạn.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 80,
  },
  {
    topic: "IT",
    title: "Đánh giá nguy cơ mất an toàn thông tin khi sử dụng Wi-Fi công cộng",
    description: "Khảo sát kiến thức về VPN, HTTPS, thói quen đăng nhập tài khoản ngân hàng trên mạng Wi-Fi quán cà phê.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 60,
  },
  {
    topic: "MARKETING",
    title: "Hiệu quả của các chiến dịch quảng cáo trên nền tảng Threads và Instagram",
    description: "Tìm hiểu mức độ tương tác với các bài viết tài trợ, sự chân thật của nội dung chia sẻ và xu hướng theo dõi người nổi tiếng.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 70,
  },
  {
    topic: "BUSINESS",
    title: "Khảo sát ý định khởi nghiệp trong lĩnh vực công nghệ giáo dục (EdTech)",
    description: "Tìm hiểu về nhu cầu học trực tuyến chất lượng cao, các tính năng luyện đề tương tác và mức học phí hợp lý.",
    estimatedDurationMinutes: 9,
    rewardPerResponse: 15,
    expectedCompletions: 45,
  },
  {
    topic: "MENTAL_HEALTH",
    title: "Khảo sát mức độ quan tâm đến sức khỏe tinh thần và tư vấn tâm lý học đường",
    description: "Đánh giá thái độ của sinh viên khi gặp khủng hoảng tâm lý và sự sẵn sàng tìm kiếm chuyên gia tư vấn hoặc phòng tâm lý trường.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 50,
  },
  {
    topic: "EDUCATION",
    title: "Văn hóa câu lạc bộ sinh viên và kỹ năng mềm tích lũy được trong trường đại học",
    description: "Khảo sát lợi ích khi tham gia CLB (kết nối bạn bè, tổ chức sự kiện) và xung đột thời gian với việc học trên giảng đường.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 85,
  },
  {
    topic: "ARTS_MUSIC",
    title: "Xu hướng sử dụng linh vật (Mascot) thương hiệu trong thiết kế đồ họa đương đại",
    description: "Đánh giá sự ghi nhớ thương hiệu thông qua các nhân vật ngộ nghĩnh (Mascot) và cảm xúc kết nối tích cực với người dùng trẻ.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 50,
  },
  {
    topic: "SCHOOL_PSYCHOLOGY",
    title: "Tác động của việc giao lưu văn hóa đa quốc gia trong môi trường đại học",
    description: "Khảo sát kinh nghiệm tương tác với sinh viên quốc tế, khả năng thấu hiểu sự khác biệt và phát triển tư duy toàn cầu.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 40,
  },
  {
    topic: "RESEARCH",
    title: "Ứng dụng công nghệ in 3D trong nghiên cứu và chế tạo mô hình kỹ thuật",
    description: "Tìm hiểu mức độ tiếp cận máy in 3D của sinh viên khối kỹ thuật, chi phí vật liệu và ứng dụng vào đồ án môn học.",
    estimatedDurationMinutes: 9,
    rewardPerResponse: 20,
    expectedCompletions: 35,
  },
  {
    topic: "OTHER",
    title: "Thói quen sử dụng cà phê và không gian học tập tại các quán Coffee Work",
    description: "Khảo sát các yếu tố chọn quán học bài: ổ cắm điện, ánh sáng, âm nhạc nhẹ nhàng, giá nước và tốc độ Wi-Fi.",
    estimatedDurationMinutes: 5,
    rewardPerResponse: 10,
    expectedCompletions: 95,
  },
  {
    topic: "IT",
    title: "Nghiên cứu mức độ đón nhận công nghệ Blockchain và Web3 trong giới sinh viên",
    description: "Khảo sát sự hiểu biết về Smart Contract, tiền mã hóa, ví kỹ thuật số và các tiềm năng ứng dụng thực tế ngoài đầu cơ.",
    estimatedDurationMinutes: 10,
    rewardPerResponse: 20,
    expectedCompletions: 45,
  },
  {
    topic: "MARKETING",
    title: "Đánh giá mức độ trung thành của khách hàng đối với các chuỗi đồ uống hiện nay",
    description: "Khảo sát các yếu tố giữ chân người tiêu dùng: chương trình tích điểm, hương vị đồ uống, không gian quán hay dịch vụ khách hàng.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 80,
  },
  {
    topic: "BUSINESS",
    title: "Khảo sát phương pháp quản lý chi tiêu theo quy tắc 6 chiếc lọ của sinh viên",
    description: "Đánh giá tính khả thi khi áp dụng quy tắc phân chia tài chính (thiết yếu, giáo dục, tiết kiệm, hưởng thụ) trong thực tế.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 60,
  },
  {
    topic: "MENTAL_HEALTH",
    title: "Khảo sát mức độ vận động thể chất và thói quen ngồi lâu trước màn hình máy tính",
    description: "Tìm hiểu hội chứng đau vai gáy, mỏi mắt ở sinh viên công nghệ và các bài tập giãn cơ tại chỗ được áp dụng.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 75,
  },
  {
    topic: "EDUCATION",
    title: "Đánh giá tiện ích xe buýt điện và giao thông công cộng đối với sinh viên",
    description: "Khảo sát tần suất đi lại, sự tiện lợi của lộ trình, giá vé ưu đãi sinh viên và thái độ phục vụ của nhân viên.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 80,
  },
  {
    topic: "ARTS_MUSIC",
    title: "Thiết kế hệ thống nhận diện thương hiệu cho các sự kiện văn hóa học đường",
    description: "Đánh giá vai trò của poster, standee, merchandise và màu sắc chủ đạo trong việc thu hút sinh viên tham gia sự kiện.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 45,
  },
  {
    topic: "SCHOOL_PSYCHOLOGY",
    title: "Khảo sát phong cách học tập tối ưu: Visual, Auditory hay Kinesthetic?",
    description: "Tìm hiểu phương pháp tiếp thu kiến thức hiệu quả nhất của sinh viên qua sơ đồ tư duy, nghe giảng hay thực hành thí nghiệm.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 65,
  },
  {
    topic: "RESEARCH",
    title: "Khảo sát nhu cầu sử dụng trạm sạc xe điện thông minh tại khuôn viên đại học",
    description: "Khảo sát mức độ cần thiết của trạm sạc nhanh tại bãi đỗ xe trường học và các hình thức thanh toán tự động qua app.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 50,
  },
  {
    topic: "OTHER",
    title: "Xu hướng xem phim chiếu rạp và nền tảng xem phim trực tuyến (Netflix, VieON)",
    description: "Khảo sát tần suất ra rạp xem phim, thể loại phim yêu thích và lý do lựa chọn các gói xem phim trả phí hàng tháng.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 90,
  },
  {
    topic: "IT",
    title: "Khảo sát kiến thức về an toàn dữ liệu cá nhân khi đăng ký ứng dụng di động",
    description: "Khảo sát thói quen đọc điều khoản quyền truy cập (danh bạ, vị trí, ảnh) và nhận thức về rủi ro lộ lọt dữ liệu số.",
    estimatedDurationMinutes: 9,
    rewardPerResponse: 15,
    expectedCompletions: 55,
  },
  {
    topic: "MARKETING",
    title: "Hành vi so sánh giá và săn mã giảm giá (Voucher) trên sàn TMĐT của sinh viên",
    description: "Đánh giá mức độ kiên nhẫn khi canh giờ Flash Sale (0h, 12h) và tác động của phí ship đến quyết định chốt đơn.",
    estimatedDurationMinutes: 7,
    rewardPerResponse: 15,
    expectedCompletions: 85,
  },
  {
    topic: "BUSINESS",
    title: "Đánh giá kỹ năng đàm phán và thuyết phục trong môi trường làm việc nhóm",
    description: "Tìm hiểu các bất đồng phổ biến khi làm đồ án nhóm và phương pháp giải quyết xung đột ý kiến hiệu quả.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 60,
  },
  {
    topic: "MENTAL_HEALTH",
    title: "Thực trạng sử dụng thực phẩm chức năng và viên uống bổ sung vitamin ở giới trẻ",
    description: "Khảo sát lý do sử dụng thực phẩm chức năng (đẹp da, tăng sức đề kháng, sáng mắt) và nguồn thông tin tư vấn tin cậy.",
    estimatedDurationMinutes: 6,
    rewardPerResponse: 10,
    expectedCompletions: 70,
  },
  {
    topic: "EDUCATION",
    title: "Khảo sát các áp lực thi cử và phương pháp giải tỏa mùa đồ án tốt nghiệp",
    description: "Đánh giá mức độ quá tải thời gian, các phương pháp xả stress (nghe nhạc, đi cà phê cùng bạn bè) và sự hỗ trợ từ gia đình.",
    estimatedDurationMinutes: 8,
    rewardPerResponse: 15,
    expectedCompletions: 75,
  },
];

function generateFormBlocks(title) {
  return [
    {
      id: "q-single-1",
      order: 0,
      type: "single_choice",
      title: "Bạn đánh giá mức độ quan tâm của bản thân đối với chủ đề này như thế nào?",
      required: true,
      options: [
        { id: "opt-1", label: "Rất quan tâm, thường xuyên tìm hiểu", value: "very_interested" },
        { id: "opt-2", label: "Có quan tâm nhưng chưa có nhiều thời gian", value: "moderately_interested" },
        { id: "opt-3", label: "Bình thường / Chỉ biết sơ qua", value: "neutral" },
        { id: "opt-4", label: "Không quan tâm lắm", value: "not_interested" },
      ],
    },
    {
      id: "q-multi-1",
      order: 1,
      type: "multiple_choice",
      title: "Những nguồn thông tin nào bạn thường tiếp cận nhiều nhất? (Chọn tất cả đáp án phù hợp)",
      required: true,
      minSelections: 1,
      options: [
        { id: "opt-m1", label: "Mạng xã hội (Facebook, TikTok, Instagram)", value: "social_media" },
        { id: "opt-m2", label: "Bài giảng, tài liệu học thuật tại trường", value: "academic" },
        { id: "opt-m3", label: "Bạn bè, người thân xung quanh", value: "peers" },
        { id: "opt-m4", label: "Các hội nhóm chuyên môn / Diễn đàn trực tuyến", value: "forums" },
        { id: "opt-m5", label: "Trợ lý AI / Công cụ tìm kiếm Google", value: "ai_search" },
      ],
    },
    {
      id: "q-scale-1",
      order: 2,
      type: "linear_scale",
      title: "Mức độ hài lòng hoặc sự cần thiết của vấn đề này trong thực tế (1: Rất thấp ➔ 5: Rất cao)",
      required: true,
      min: 1,
      max: 5,
      minLabel: "Rất thấp",
      maxLabel: "Rất cao",
    },
    {
      id: "q-text-1",
      order: 3,
      type: "textarea",
      title: "Bạn có góp ý hoặc chia sẻ thêm góc nhìn nào để cải thiện vấn đề trên không?",
      required: false,
      placeholder: "Chia sẻ ngắn gọn quan điểm của bạn...",
    },
  ];
}

async function main() {
  console.log("=== BẮT ĐẦU SEED 10 USERS & 50 BÀI KHẢO SÁT ===");

  // 1. Password hash
  const passwordHash = bcrypt.hashSync("Password123456!", 10);

  // 2. Tìm admin user để làm reviewer duyệt khảo sát
  let admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    admin = await prisma.user.findFirst();
  }
  const adminId = admin ? admin.id : null;
  console.log(`Reviewer Admin ID: ${adminId} (${admin?.email || "none"})`);

  // 3. Tạo 10 Users
  const createdUsers = [];
  for (const u of SEED_USERS) {
    let user = await prisma.user.findUnique({ where: { email: u.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: u.email,
          passwordHash,
          role: "PUBLISHER",
          status: "ACTIVE",
          profile: {
            create: {
              displayName: u.displayName,
              birthYear: u.birthYear,
              school: u.school,
              schoolYear: u.schoolYear,
              goal: "COLLECT",
            },
          },
          demographicProfile: {
            create: {
              age: 2026 - u.birthYear,
              location: u.location,
              householdIncome: "Dưới 5 triệu VNĐ/tháng",
              specificInterests: ["Học thuật", "Nghiên cứu khoa học", u.fieldOfStudy],
            },
          },
        },
      });

      // Tạo 4 LedgerAccount cho user
      for (const accountClass of ["USER_AVAILABLE", "PENDING", "FROZEN", "ESCROW"]) {
        await prisma.ledgerAccount.create({
          data: {
            userId: user.id,
            accountClass,
            currency: "POINTS",
          },
        });
      }
      console.log(`Đã tạo User: ${u.displayName} (${u.email})`);
    } else {
      console.log(`User đã tồn tại: ${u.email}`);
      for (const accountClass of ["USER_AVAILABLE", "PENDING", "FROZEN", "ESCROW"]) {
        const existingAcc = await prisma.ledgerAccount.findUnique({
          where: { userId_accountClass_currency: { userId: user.id, accountClass, currency: "POINTS" } }
        });
        if (!existingAcc) {
          await prisma.ledgerAccount.create({
            data: {
              userId: user.id,
              accountClass,
              currency: "POINTS",
            },
          });
        }
      }
    }
    createdUsers.push(user);
  }

  // 4. Tạo 50 Surveys
  console.log("\nBắt đầu tạo 50 bài khảo sát...");
  let count = 0;
  for (let i = 0; i < SURVEY_TEMPLATES.length; i++) {
    const tpl = SURVEY_TEMPLATES[i];
    // Gán xoay vòng cho 10 user: mỗi user sở hữu 5 survey
    const owner = createdUsers[i % createdUsers.length];

    // Tạo thời điểm tạo ngẫu nhiên trong vòng 14 ngày qua để feed phong phú
    const daysAgo = Math.floor(Math.random() * 14);
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - Math.floor(Math.random() * 86400000));
    const deadlineAt = new Date(Date.now() + (15 + Math.floor(Math.random() * 30)) * 24 * 60 * 60 * 1000);

    const blocks = generateFormBlocks(tpl.title);
    const schemaJson = {
      schemaVersion: 1,
      title: tpl.title,
      description: tpl.description,
      blocks,
      settings: {
        shuffleBlocks: false,
        progressBar: true,
        requireAuth: true,
        allowPublicAccess: false,
      },
    };

    // Kiểm tra trùng lặp theo title
    let form = await prisma.form.findFirst({ where: { title: tpl.title } });
    if (!form) {
      form = await prisma.form.create({
        data: {
          publisherId: owner.id,
          type: "INTERNAL",
          status: "PUBLISHED",
          title: tpl.title,
          description: tpl.description,
          rewardPerResponse: tpl.rewardPerResponse,
          expectedCompletions: tpl.expectedCompletions,
          estimatedDurationMinutes: tpl.estimatedDurationMinutes,
          topic: tpl.topic,
          deadlineAt,
          createdAt,
          updatedAt: createdAt,
          versions: {
            create: {
              versionNumber: 1,
              schemaJson,
              targetingJson: {},
              isPublished: true,
              publishedAt: createdAt,
              createdAt,
            },
          },
        },
        include: { versions: true },
      });

      // Tạo moderation decision nếu có admin
      if (adminId && form.versions.length > 0) {
        await prisma.surveyModerationDecision.create({
          data: {
            formId: form.id,
            formVersionId: form.versions[0].id,
            versionNumber: 1,
            outcome: "APPROVED",
            adminId,
            reason: "Khảo sát đạt chuẩn nội dung nghiên cứu học thuật.",
            correlationId: form.id,
            decidedAt: createdAt,
            createdAt,
          },
        });
      }
      count++;
      console.log(`[${count}/50] Tạo khảo sát: "${tpl.title.substring(0, 50)}..." (Sở hữu: ${owner.email})`);
    } else {
      console.log(`Khảo sát đã tồn tại: "${tpl.title.substring(0, 50)}..."`);
    }
  }

  console.log(`\n=== HOÀN TẤT! Đã tạo thành công 10 Users và 50 bài khảo sát vào hệ thống! ===`);
}

main()
  .catch((e) => {
    console.error("Lỗi khi seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
