import React from "react";
import { Link } from "react-router-dom";
import { Box, Flex, Text } from "@radix-ui/themes";
import { ChevronRight } from "lucide-react";

/**
 * PageSubheader renders a secondary header with breadcrumbs and optional right-side content.
 * Intended to be placed directly below main navigation header.
 */
export default function PageSubheader({
  breadcrumbs = [],
  children,
  maxWidth = "max-w-7xl",
}) {
  return (
    <Box
      role="region"
      aria-label="Page header"
      className="border-b border-gray-300 bg-gray-1/60 backdrop-blur supports-[backdrop-filter]:bg-gray-1/40 mb-4"
    >
      <Flex
        align="center"
        justify="between"
        className={`mx-auto w-full ${maxWidth} px-1.5 py-3`}
        gap="4"
        wrap="wrap"
      >
        <Flex align="center" gap="3" className="min-w-0 flex-1">
          {breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="shrink-0">
              <ol className="flex items-center gap-2 text-sm text-gray-11">
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  return (
                    <React.Fragment key={index}>
                      {index > 0 && (
                        <ChevronRight
                          className="h-4 w-4 text-gray-9"
                          aria-hidden="true"
                        />
                      )}
                      {crumb.href ? (
                        <Link
                          to={crumb.href}
                          className="hover:text-gray-12 transition-colors underline-offset-4 hover:underline"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <Text
                          as="span"
                          aria-current={isLast ? "page" : undefined}
                          className={isLast ? "text-gray-12 font-medium" : ""}
                        >
                          {crumb.label}
                        </Text>
                      )}
                    </React.Fragment>
                  );
                })}
              </ol>
            </nav>
          )}
        </Flex>

        {/* Right side content */}
        {children && (
          <Flex align="center" gap="3" className="shrink-0">
            {children}
          </Flex>
        )}
      </Flex>
    </Box>
  );
}
