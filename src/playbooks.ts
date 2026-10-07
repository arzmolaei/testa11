/** Project recipes are ordinary source data. They never call an external service. */
export type ProjectPlaybook = {
  id: string;
  label: string;
  audience: string;
  conversionGoal: string;
  briefTemplate: string;
  groupingRules?: string;
  projectType?: string;
};

export const PROJECT_PLAYBOOKS: readonly Readonly<ProjectPlaybook>[] = Object.freeze([
  Object.freeze({
    id: "ecommerce", label: "فروشگاهی", projectType: "Ecommerce",
    audience: "خریدارانی که محصول مناسب را مقایسه و انتخاب می‌کنند.",
    conversionGoal: "خرید محصول یا ورود به دسته‌بندی مرتبط",
    briefTemplate: "نیاز و کاربرد محصول\nمعیارهای انتخاب\nویژگی‌ها و تفاوت‌ها\nپرسش‌های خریداران\nراهنمای انتخاب و دعوت به خرید",
    groupingRules: "نام مدل و برند حفظ شود. خرید و قیمت یک محصول می‌توانند با صفحه همان محصول هدف‌گذاری شوند؛ آموزش و خدمات نصب جداگانه بررسی شوند.",
  }),
  Object.freeze({
    id: "services", label: "خدماتی", projectType: "Service",
    audience: "افرادی که برای حل یک مسئله به متخصص یا ارائه‌دهنده خدمت نیاز دارند.",
    conversionGoal: "درخواست مشاوره، تماس یا ثبت سفارش خدمت",
    briefTemplate: "مسئله و نتیجه مورد انتظار\nدامنه خدمت و مراحل اجرا\nهزینه و عوامل مؤثر\nنمونه کار و شواهد اعتماد\nپرسش‌ها و درخواست مشاوره",
    groupingRules: "عبارت‌های مربوط به سفارش و هزینه همان خدمت کنار هم بررسی شوند. آموزش انجام کار و خدمت حرفه‌ای هدف یکسانی ندارند.",
  }),
  Object.freeze({
    id: "local", label: "سئوی محلی", projectType: "Local SEO",
    audience: "مشتریان محدوده جغرافیایی خدمت‌رسانی کسب‌وکار",
    conversionGoal: "تماس، مسیریابی یا رزرو خدمت در محدوده واقعی فعالیت",
    briefTemplate: "خدمت و محدوده واقعی فعالیت\nآدرس، راه‌های تماس و ساعات کاری\nشواهد محلی و تجربه مشتری\nفرایند رزرو یا مراجعه\nپرسش‌ها و دعوت به تماس",
    groupingRules: "نام شهر و محله حفظ شود. ساخت صفحات مشابه برای تمام محله‌ها بدون اطلاعات اختصاصی پیشنهاد نمی‌شود.",
  }),
  Object.freeze({
    id: "blog", label: "محتوایی و وبلاگ", projectType: "Content / Blog",
    audience: "خوانندگانی که پاسخ روشن، آموزش یا راهنمای تصمیم‌گیری می‌خواهند.",
    conversionGoal: "حل پرسش مخاطب و هدایت به مطلب، محصول یا خدمت مرتبط",
    briefTemplate: "پاسخ کوتاه و مستقیم\nتوضیح و مراحل کاربردی\nمثال‌ها و محدودیت‌ها\nپرسش‌های مرتبط\nمنابع قابل بررسی و قدم بعدی مخاطب",
    groupingRules: "پرسش‌های هم‌هدف در یک مقاله بررسی شوند. مقایسه و راهنمای خرید از آموزش عمومی تفکیک و به صفحه تجاری مرتبط متصل شوند.",
  }),
  Object.freeze({
    id: "mixed", label: "ترکیبی", projectType: "Mixed",
    audience: "مخاطبان در مراحل آشنایی، بررسی و اقدام",
    conversionGoal: "اتصال محتوای آموزشی به صفحات تجاری و هدف اصلی پروژه",
    briefTemplate: "نیاز مخاطب و هدف صفحه\nپاسخ یا پیشنهاد اصلی\nبخش‌های ضروری و شواهد\nپرسش‌های مرتبط\nلینک به مرحله بعد و دعوت به اقدام",
    groupingRules: "موضوع مشترک به‌تنهایی کافی نیست؛ هدف اطلاعاتی، راهنمای خرید، محصول و خدمات جدا بررسی شوند.",
  }),
]);

/** Always copy a recipe: changing one project's brief must not alter another. */
export function cloneProjectPlaybook(playbook: ProjectPlaybook): ProjectPlaybook {
  return {
    id: playbook.id, label: playbook.label, audience: playbook.audience,
    conversionGoal: playbook.conversionGoal, briefTemplate: playbook.briefTemplate,
    ...(playbook.groupingRules !== undefined ? { groupingRules: playbook.groupingRules } : {}),
    ...(playbook.projectType !== undefined ? { projectType: playbook.projectType } : {}),
  };
}

export function findProjectPlaybook(id: string, customPlaybooks: ProjectPlaybook[] = []): ProjectPlaybook | undefined {
  const found = customPlaybooks.find((playbook) => playbook.id === id) || PROJECT_PLAYBOOKS.find((playbook) => playbook.id === id);
  return found ? cloneProjectPlaybook(found) : undefined;
}

/** Also used at backup/import boundaries. Reject malformed rather than silently truncate. */
export function validateProjectPlaybook(input: unknown): ProjectPlaybook {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("الگوی پروژه معتبر نیست.");
  const candidate = input as Record<string, unknown>;
  const limits: Record<string, number> = { id: 120, label: 100, audience: 2000, conversionGoal: 2000, briefTemplate: 12000, groupingRules: 6000, projectType: 100 };
  const required = new Set(["id", "label", "audience", "conversionGoal", "briefTemplate"]);
  const result: Record<string, string> = {};
  for (const [key, max] of Object.entries(limits)) {
    const value = candidate[key];
    if (value === undefined && !required.has(key)) continue;
    if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("فیلدهای الگوی پروژه معتبر نیستند یا بیش از حد طولانی‌اند.");
    result[key] = value.trim();
  }
  if (!result.id || !result.label) throw new Error("نام و شناسه الگوی پروژه لازم است.");
  return cloneProjectPlaybook(result as ProjectPlaybook);
}

export function createCustomPlaybook(value: ProjectPlaybook): ProjectPlaybook {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? `custom-${crypto.randomUUID()}` : `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return validateProjectPlaybook({ ...value, id });
}
