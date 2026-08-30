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
  ownProfile: "/profiel",
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
  | "story"
  | "book"
  | "add"
  | "profile";

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
    id: "story",
    label: "Verhaal",
    href: PRODUCT_ROUTES.newProject,
    icon: "story",
    exact: true,
    requiresAuth: true,
  },
  {
    id: "update",
    label: "Toevoegen",
    href: PRODUCT_ROUTES.newProject,
    icon: "add",
    primaryAction: true,
    requiresAuth: true,
  },
  {
    id: "photobook",
    label: "Bouwboek",
    href: PRODUCT_ROUTES.newProject,
    icon: "book",
    exact: true,
    requiresAuth: true,
  },
  {
    id: "profile",
    label: "Profiel",
    href: PRODUCT_ROUTES.ownProfile,
    icon: "profile",
    exact: true,
    requiresAuth: true,
  },
];

interface MobileNavigationOverrides {
  storyHref?: string;
  photobookHref?: string;
  profileHref?: string;
  updateHref?: string;
}

export const getMobileNavigationItems = ({
  storyHref = PRODUCT_ROUTES.newProject,
  photobookHref = PRODUCT_ROUTES.newProject,
  profileHref = PRODUCT_ROUTES.ownProfile,
  updateHref = PRODUCT_ROUTES.newProject,
}: MobileNavigationOverrides = {}): readonly ProductNavigationItem[] =>
  MOBILE_NAVIGATION_ITEMS.map((item) => {
    if (item.id === "story") return { ...item, href: storyHref };
    if (item.id === "photobook") return { ...item, href: photobookHref };
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
