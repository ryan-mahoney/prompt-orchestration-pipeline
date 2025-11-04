import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Box, Flex, Text, Heading, Link as RadixLink } from "@radix-ui/themes";
import { Button } from "./ui/button.jsx";
import Logo from "./ui/Logo.jsx";
import { ArrowLeft, Home, Code2 } from "lucide-react";
import "./ui/focus-styles.css";

/**
 * Shared Layout component that provides consistent header, navigation,
 * and container structure across all pages.
 */
export default function Layout({
  children,
  title,
  actions,
  showBackButton = false,
  backTo = "/",
  maxWidth = "max-w-7xl",
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine active navigation based on current path
  const isActivePath = (path) => {
    if (path === "/" && location.pathname === "/") return true;
    if (path !== "/" && location.pathname.startsWith(path)) return true;
    return false;
  };

  const handleBack = () => {
    navigate(backTo);
  };

  return (
    <Tooltip.Provider delayDuration={200}>
      <Box className="min-h-screen bg-gray-1">
        {/* Skip to main content link for accessibility */}
        <Box
          as="a"
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 z-50 bg-blue-600 text-white px-3 py-2 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Skip to main content
        </Box>

        {/* Header */}
        <Box
          role="banner"
          className="sticky top-0 z-20 border-b border-gray-300 bg-gray-1/80 backdrop-blur supports-[backdrop-filter]:bg-gray-1/60"
        >
          <Flex
            align="center"
            justify="between"
            className={`mx-auto w-full ${maxWidth} px-4 sm:px-6 lg:px-8 py-4`}
            gap="4"
          >
            {/* Left side: Navigation and title */}
            <Flex align="center" gap="3" className="min-w-0 flex-1">
              {/* Back button (conditional) */}
              {showBackButton && (
                <Tooltip.Root delayDuration={200}>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBack}
                      className="shrink-0"
                      aria-label="Go back"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side="bottom" sideOffset={5}>
                    <Text size="2">Go back</Text>
                  </Tooltip.Content>
                </Tooltip.Root>
              )}

              {/* Logo */}
              <Box
                className="shrink-0"
                style={{ width: "80px", height: "60px" }}
              >
                <Logo />
              </Box>

              {/* App title */}
              <Heading
                size="6"
                weight="medium"
                className="text-gray-12 truncate"
              >
                {title || (
                  <>
                    Prompt
                    <br />
                    Pipeline
                  </>
                )}
              </Heading>
            </Flex>

            {/* Center: Navigation */}
            <nav
              role="navigation"
              aria-label="Main navigation"
              className="hidden md:flex"
            >
              <Flex align="center" gap="6">
                <RadixLink
                  href="/"
                  className={`text-sm font-medium transition-colors hover:text-blue-600 ${
                    isActivePath("/")
                      ? "text-blue-600"
                      : "text-gray-11 hover:text-gray-12"
                  }`}
                  aria-current={isActivePath("/") ? "page" : undefined}
                >
                  <Flex align="center" gap="2">
                    <Home className="h-4 w-4" />
                    Dashboard
                  </Flex>
                </RadixLink>
                <RadixLink
                  href="/code"
                  className={`text-sm font-medium transition-colors hover:text-blue-600 ${
                    isActivePath("/code")
                      ? "text-blue-600"
                      : "text-gray-11 hover:text-gray-12"
                  }`}
                  aria-current={isActivePath("/code") ? "page" : undefined}
                >
                  <Flex align="center" gap="2">
                    <Code2 className="h-4 w-4" />
                    Code
                  </Flex>
                </RadixLink>
              </Flex>
            </nav>

            {/* Right side: Actions */}
            {actions && (
              <Flex align="center" gap="3" className="shrink-0">
                {actions}
              </Flex>
            )}
          </Flex>
        </Box>

        {/* Main content */}
        <main
          id="main-content"
          role="main"
          className={`mx-auto w-full ${maxWidth} px-4 sm:px-6 lg:px-8 py-6`}
        >
          {children}
        </main>
      </Box>
    </Tooltip.Provider>
  );
}
