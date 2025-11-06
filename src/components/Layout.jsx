import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Box, Flex, Text, Heading, Link as RadixLink } from "@radix-ui/themes";
import { Button } from "./ui/button.jsx";
import Logo from "./ui/Logo.jsx";
import PageSubheader from "./PageSubheader.jsx";
import UploadSeed from "./UploadSeed.jsx";
import { ArrowLeft, Code2, Upload } from "lucide-react";
import "./ui/focus-styles.css";

/**
 * Shared Layout component that provides consistent header, navigation,
 * and container structure across all pages.
 */
export default function Layout({
  children,
  title,
  pageTitle,
  breadcrumbs,
  actions,
  backTo = "/",
  maxWidth = "max-w-7xl",
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [seedUploadSuccess, setSeedUploadSuccess] = useState(null);
  const [seedUploadTimer, setSeedUploadTimer] = useState(null);
  const uploadPanelRef = useRef(null);

  // Determine active navigation based on current path
  const isActivePath = (path) => {
    if (path === "/" && location.pathname === "/") return true;
    if (path !== "/" && location.pathname.startsWith(path)) return true;
    return false;
  };

  const handleBack = () => {
    navigate(backTo);
  };

  const toggleUploadPanel = () => {
    setIsUploadOpen(!isUploadOpen);
  };

  // Handle seed upload success
  const handleSeedUploadSuccess = ({ jobName }) => {
    // Clear any existing timer
    if (seedUploadTimer) {
      clearTimeout(seedUploadTimer);
    }

    // Set success message
    setSeedUploadSuccess(jobName);

    // Auto-clear after exactly 5000 ms
    const timer = setTimeout(() => {
      setSeedUploadSuccess(null);
      setSeedUploadTimer(null);
    }, 5000);

    setSeedUploadTimer(timer);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (seedUploadTimer) {
        clearTimeout(seedUploadTimer);
      }
    };
  }, [seedUploadTimer]);

  // Focus upload panel when opened
  useEffect(() => {
    if (isUploadOpen && uploadPanelRef.current) {
      const uploadArea = uploadPanelRef.current.querySelector(
        '[data-testid="upload-area"]'
      );
      if (uploadArea) {
        uploadArea.focus();
      }
    }
  }, [isUploadOpen]);

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
            <Flex align="center" className="min-w-0 flex-1">
              {/* Logo */}
              <Box
                asChild
                className="shrink-0"
                style={{ width: "80px", height: "60px" }}
              >
                <Link
                  to="/"
                  aria-label="Go to homepage"
                  className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <Logo />
                </Link>
              </Box>

              {/* App title - clickable to navigate to dashboard */}
              <Box
                asChild
                className="shrink-0 cursor-pointer hover:bg-gray-3 rounded p-1 -m-1 transition-colors"
                onClick={() => navigate("/")}
              >
                <Heading
                  size="6"
                  weight="medium"
                  className="text-gray-12 truncate"
                >
                  <>
                    Prompt
                    <br />
                    Pipeline
                  </>
                </Heading>
              </Box>
            </Flex>

            {/* Center: Navigation */}
            <nav
              role="navigation"
              aria-label="Main navigation"
              className="hidden md:flex"
            >
              <Flex align="center" gap="6">
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
                    Help
                  </Flex>
                </RadixLink>
              </Flex>
            </nav>

            {/* Right side: Actions */}
            <Flex align="center" gap="3" className="shrink-0">
              {actions}
              <Tooltip.Root delayDuration={200}>
                <Tooltip.Trigger asChild>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={toggleUploadPanel}
                    aria-controls="layout-upload-panel"
                    aria-expanded={isUploadOpen}
                  >
                    <Upload className="h-4 w-4" />
                    <Text size="2" className="ml-2">
                      Upload Seed
                    </Text>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side="bottom" sideOffset={5}>
                  <Text size="2">Upload seed file</Text>
                </Tooltip.Content>
              </Tooltip.Root>
            </Flex>
          </Flex>
        </Box>

        {/* Upload Panel */}
        {isUploadOpen && (
          <Box
            id="layout-upload-panel"
            ref={uploadPanelRef}
            role="region"
            aria-label="Upload seed file"
            className="bg-blue-50"
          >
            <Flex
              direction="column"
              gap="3"
              className={`mx-auto w-full ${maxWidth} px-4 sm:px-6 lg:px-8 py-4`}
            >
              {/* Success Message */}
              {seedUploadSuccess && (
                <Box className="rounded-md bg-green-50 p-3 border border-green-200">
                  <Text size="2" className="text-green-800">
                    Job <strong>{seedUploadSuccess}</strong> created
                    successfully
                  </Text>
                </Box>
              )}

              <UploadSeed onUploadSuccess={handleSeedUploadSuccess} />
            </Flex>
          </Box>
        )}

        {/* Main content */}
        <main
          id="main-content"
          role="main"
          className={`mx-auto w-full ${maxWidth} px-4 sm:px-6 lg:px-8`}
        >
          {children}
        </main>
      </Box>
    </Tooltip.Provider>
  );
}
