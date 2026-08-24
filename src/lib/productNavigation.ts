export const PRODUCT_ROUTES = {
  landing: "/",
  projects: "/projecten",
  following: "/volgend",
  createUpdate: "/update/nieuw",
  discover: "/ontdekken",
  connections: "/connecties",
  notifications: "/notificaties",
  orders: "/bestellingen",
  account: "/account",
  feedback: "/feedback",
  share: "/delen",
  newProject: "/project/nieuw",
  project: (projectId: string) => `/project/${encodeURIComponent(projectId)}`,
  projectBudget: (projectId: string) => `/project/${encodeURIComponent(projectId)}/budget`,
  projectPhotobook: (projectId: string) => `/project/${encodeURIComponent(projectId)}/bouwboek`,
  order: (orderId: string) => `/bestellingen/${encodeURIComponent(orderId)}`,
  projectUpdateComposer: (projectId: string) => `/project/${encodeURIComponent(projectId)}?update=nieuw`,
  projectUpdate: (projectId: string, updateId: string) => {
    const query = new URLSearchParams({ update: updateId });
    return `/project/${encodeURIComponent(projectId)}?${query.toString()}`;
  },
  profile: (profileKey: string) => `/profiel/${encodeURIComponent(profileKey)}`,
} as const;

export type ProductNavigationIcon =
  | "projects"
  | "following"
  | "add"
  | "discover"
  | "profile"
  | "connections"
  | "notifications"
  | "orders"
  | "account"
  | "feedback";

export interface ProductNavigationItem {
  id: string;
  label: string;
  href: string;
  icon: ProductNavigationIcon;
  exact?: boolean;
  primaryAction?: boolean;
  requiresAuth?: boolean;
}

export const MOBILE_NAVIGATION_ITEMS: readonly ProductNavigationItem[] = [
  {
    id: "projects",
    label: "Verbouwingen",
    href: PRODUCT_ROUTES.projects,
    icon: "projects",
    requiresAuth: true,
  },
  {
    id: "following",
    label: "Volgend",
    href: PRODUCT_ROUTES.following,
    icon: "following",
    requiresAuth: true,
  },
  {
    id: "update",
    label: "Bouwmoment",
    href: PRODUCT_ROUTES.createUpdate,
    icon: "add",
    primaryAction: true,
    requiresAuth: true,
  },
  {
    id: "discover",
    label: "Verhalen",
    href: PRODUCT_ROUTES.discover,
    icon: "discover",
  },
  {
    id: "profile",
    label: "Profiel",
    href: PRODUCT_ROUTES.account,
    icon: "profile",
    requiresAuth: true,
  },
];

export const PRIMARY_NAVIGATION_ITEMS: readonly ProductNavigationItem[] = [
  MOBILE_NAVIGATION_ITEMS[0],
  MOBILE_NAVIGATION_ITEMS[1],
  MOBILE_NAVIGATION_ITEMS[3],
  {
    id: "connections",
    label: "Connecties",
    href: PRODUCT_ROUTES.connections,
    icon: "connections",
    requiresAuth: true,
  },
];

export const ACCOUNT_NAVIGATION_ITEMS: readonly ProductNavigationItem[] = [
  {
    id: "orders",
    label: "Bestellingen",
    href: PRODUCT_ROUTES.orders,
    icon: "orders",
    requiresAuth: true,
  },
  {
    id: "notifications",
    label: "Notificaties",
    href: PRODUCT_ROUTES.notifications,
    icon: "notifications",
    requiresAuth: true,
  },
  {
    id: "account",
    label: "Account en privacy",
    href: PRODUCT_ROUTES.account,
    icon: "account",
    requiresAuth: true,
  },
  {
    id: "feedback",
    label: "Feedback",
    href: PRODUCT_ROUTES.feedback,
    icon: "feedback",
    requiresAuth: true,
  },
];

interface MobileNavigationOverrides {
  profileHref?: string;
  updateHref?: string;
}

export const getMobileNavigationItems = ({
  profileHref = PRODUCT_ROUTES.account,
  updateHref = PRODUCT_ROUTES.createUpdate,
}: MobileNavigationOverrides = {}): readonly ProductNavigationItem[] =>
  MOBILE_NAVIGATION_ITEMS.map((item) => {
    if (item.id === "profile") return { ...item, href: profileHref };
    if (item.id === "update") return { ...item, href: updateHref };
    return item;
  });

export const isProductPathActive = (
  pathname: string,
  item: Pick<ProductNavigationItem, "href" | "exact">,
) => {
  const currentPath = pathname.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  const itemPath = item.href.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";

  if (item.exact || itemPath === "/") return currentPath === itemPath;
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
};
