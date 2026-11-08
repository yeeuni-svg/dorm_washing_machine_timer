import type { Metadata } from "next";
export const metadata:Metadata={title:"율곡관 스마트 세탁실",description:"기기 상태와 남은 시간을 확인하는 비공개 연결 테스트",icons:{icon:"/favicon.svg"}};
export default function Layout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ko"><head><link rel="stylesheet" href="/style.css"/></head><body>{children}</body></html>;}
